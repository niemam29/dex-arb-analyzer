// Handler zadania `train`: trenuje ANFIS na `trainWindows` (opcjonalnie ewaluuje na
// `testWindows` — inaczej odcina chronologicznie 20% z `trainWindows`, GRUPOWO ŚWIADOME,
// patrz `splitTrainTestByTime`), zapisuje nowy wiersz `scoring_models`
// (kind='anfis') i ocenia WSZYSTKIE block_states okien trainWindows+testWindows (każda para) do
// `model_scores` (reużywa `writeModelScores`, tak jak `analyzePairWindow` dla baseline/mamdani).
import { sql } from "drizzle-orm";
import { schema, type Db } from "@dex-arb/db";
import { AnfisModel, DEFAULT_MAMDANI_PARAMS, SCORE_THRESHOLD, initFromMamdani, trainAnfis, type AnfisParams, type EpochStat } from "@dex-arb/core";
import {
  buildDataset,
  collectProvenance,
  computeGroupKeys,
  filterK0,
  isVerifiedKnownOpportunity,
  loadLabeledRows,
  toFeatures,
  writeModelScores,
  type LabeledRow,
  type ModelScoreRow,
} from "@dex-arb/analysis";
import { AnfisMetricsSchema, type AnfisMetrics, type ModelEvaluation, type Provenance } from "@dex-arb/shared";
import type { JobContext, JobHandler, TrainParams } from "@dex-arb/shared";
import { evaluatePopulations, evaluateRows, hasKnownLabel } from "./evaluatePopulations.js";

export { hasKnownLabel };

const { scoringModels } = schema;

/**
 * Diagnostyka danych użytych w przebiegu — liczona z `rowsTrain ∪ rowsTest` faktycznie podanych
 * do `runTraining` (a więc, gdy `excludeK0` było ustawione, już PO wykluczeniu k=0), żeby liczby
 * odpowiadały danym, na których model faktycznie powstał w tym konkretnym przebiegu. Populacja:
 * zweryfikowane okazje o ZNANEJ etykiecie (`hasKnownLabel` — bez trasy `'multi'`), spójnie z
 * `evaluate`/`splitTrainTestByTime`/`buildDataset`.
 */
export interface DatasetDiagnostics {
  /** Liczba odrębnych grup (`computeGroupKeys`) wśród zweryfikowanych okazji. */
  groups: number;
  /** Liczba odrębnych grup zweryfikowanych okazji z `gas_cost_usd = 0` (pakiety Flashbots bez jawnego kosztu gazu w tx). */
  zeroGasConsumers: number;
  /** Liczba zweryfikowanych okazji `profitable_consumed=true`, których a priori szacunek (`opportunities.est_profit_usd`) był ujemny. */
  estProfitNegativeButProfitable: number;
}

/** Patrz `DatasetDiagnostics` — liczone nad `rows` (zwykle `[...rowsTrain, ...rowsTest]`). */
export function computeDiagnostics(rows: LabeledRow[]): DatasetDiagnostics {
  const verifiedOpp = rows.filter(isVerifiedKnownOpportunity);
  const keys = computeGroupKeys(verifiedOpp);
  const groups = new Set(keys).size;

  const zeroGasGroupKeys = new Set<string>();
  verifiedOpp.forEach((r, i) => {
    if (r.gasCostUsd === 0) zeroGasGroupKeys.add(keys[i]!);
  });

  const estProfitNegativeButProfitable = verifiedOpp.filter((r) => r.label === 1 && r.estProfitUsd != null && r.estProfitUsd < 0).length;

  return { groups, zeroGasConsumers: zeroGasGroupKeys.size, estProfitNegativeButProfitable };
}

/** Ewaluacja ANFIS na wierszach o znanej etykiecie (populacja block_states) — patrz `evaluatePopulations`. */
export function evaluate(params: AnfisParams, rows: LabeledRow[], threshold: number = SCORE_THRESHOLD): ModelEvaluation {
  const model = new AnfisModel(params);
  return evaluateRows((r) => model.score(toFeatures(r)).score, rows.filter(hasKnownLabel), threshold);
}

/**
 * Podział train/test BEZ losowości, używany gdy `testWindows` nie podano. GRUPOWO ŚWIADOMY: w danych 198
 * zweryfikowanych atomowych okazji pochodzi tylko z 129 unikalnych `consumer_tx_hash` — sąsiednie
 * okazje (blok B, B+1, B+2 …) potrafią dzielić TĘ SAMĄ konsumującą transakcję i mieć niemal
 * identyczne cechy/etykietę. Dzielenie WIERSZ-PO-WIERSZU przeciekałoby taką grupę jednocześnie do
 * train i test (sztucznie zawyżona metryka). Dlatego dzielimy GRUPY (`computeGroupKeys`), nie
 * wiersze: grupa dostaje etykietę większościową swoich wierszy, grupy są stratyfikowane po tej
 * etykiecie, a w KAŻDEJ klasie ostatnie `fraction` grup chronologicznie (wg pairId, potem
 * najwcześniejszy blok grupy) trafia do testu w CAŁOŚCI — żadna grupa nie jest nigdy rozdzielona
 * między train i test. Okazje bez weryfikacji oraz o nieznanej etykiecie (`hasKnownLabel`, trasa
 * `'multi'`) są pomijane (nieznana prawdziwa etykieta).
 */
export function splitTrainTestByTime(rows: LabeledRow[], fraction = 0.2): { train: LabeledRow[]; test: LabeledRow[] } {
  const usable = rows.filter(hasKnownLabel);
  const keys = computeGroupKeys(usable);

  interface GroupInfo {
    rows: LabeledRow[];
    label: 0 | 1;
    minBlock: number;
    pairId: number;
  }
  const groups = new Map<string, GroupInfo>();
  usable.forEach((r, i) => {
    const key = keys[i]!;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(r);
      if (r.block < existing.minBlock) existing.minBlock = r.block;
    } else {
      groups.set(key, { rows: [r], label: 0, minBlock: r.block, pairId: r.pairId });
    }
  });
  for (const g of groups.values()) {
    const nPos = g.rows.filter((r) => (r.isOpportunity ? r.label : 0) === 1).length;
    g.label = nPos * 2 >= g.rows.length ? 1 : 0; // etykieta większościowa grupy
  }

  const byLabel = new Map<0 | 1, GroupInfo[]>();
  for (const g of groups.values()) {
    const arr = byLabel.get(g.label);
    if (arr) arr.push(g);
    else byLabel.set(g.label, [g]);
  }

  const train: LabeledRow[] = [];
  const test: LabeledRow[] = [];
  for (const groupList of byLabel.values()) {
    const sorted = [...groupList].sort((a, b) => a.pairId - b.pairId || a.minBlock - b.minBlock);
    const nTest = Math.round(sorted.length * fraction);
    for (const g of sorted.slice(0, sorted.length - nTest)) train.push(...g.rows);
    for (const g of sorted.slice(sorted.length - nTest)) test.push(...g.rows);
  }
  return { train, test };
}

export interface RunTrainingOptions {
  seed: number;
  epochs: number;
  lr: number;
  trainWindows: number[];
  testWindows: number[];
  provenance: Provenance;
}

/** Czysta część jobu (bez bazy) — testowalna z syntetycznymi `LabeledRow[]`. */
export async function runTraining(
  rowsTrain: LabeledRow[],
  rowsTest: LabeledRow[],
  opts: RunTrainingOptions,
  onEpoch?: (e: EpochStat) => void | Promise<void>,
): Promise<{ params: AnfisParams; metrics: AnfisMetrics }> {
  const ds = buildDataset(rowsTrain, { seed: opts.seed });
  const res = await trainAnfis(ds.X, ds.y, {
    epochs: opts.epochs,
    lr: opts.lr,
    seed: opts.seed,
    init: initFromMamdani(DEFAULT_MAMDANI_PARAMS),
    // Grupowo świadomy wewnętrzny podział train/val (early stopping) — `ds.groups` wyrównane 1:1
    // z `ds.X`/`ds.y` (patrz komentarz `Dataset` w @dex-arb/analysis), żeby model nie „widział"
    // podczas treningu niemal tego samego przykładu, który potem ocenia jako walidację (ten sam
    // problem wycieku co przy podziale train/test na poziomie jobu, `splitTrainTestByTime`).
    groups: ds.groups,
    ...(onEpoch ? { onEpoch } : {}),
  });

  const model = new AnfisModel(res.params);
  const populations = evaluatePopulations((r) => model.score(toFeatures(r)).score, rowsTrain, rowsTest);
  const metrics: AnfisMetrics = AnfisMetricsSchema.parse({
    ...populations,
    history: res.history,
    bestEpoch: res.bestEpoch,
    dataset: ds.meta,
    classWeights: res.classWeights,
    seed: opts.seed,
    trainWindows: opts.trainWindows,
    testWindows: opts.testWindows,
    diagnostics: computeDiagnostics([...rowsTrain, ...rowsTest]),
    nGroupsTrain: new Set(ds.groups).size,
    provenance: opts.provenance,
  });
  return { params: res.params, metrics };
}

/** Co ile epok treningu zapisywać log/progress do bazy. */
const EPOCH_REPORT_EVERY = 5;

function checkAbort(ctx: JobContext): void {
  if (ctx.signal.aborted) throw new Error("Przerwano");
}

export function makeTrain({ db }: { db: Db }): JobHandler<TrainParams> {
  return async (params, ctx) => {
    const startedAt = Date.now();
    await ctx.log(
      `Wczytywanie danych: trainWindows=[${params.trainWindows.join(",")}] testWindows=[${params.testWindows.join(",")}]`,
    );
    // trainRawFull/testRawFull: WSZYSTKIE block_states okien (niefiltrowane) — potrzebne
    // niezmienione na końcu, do oceny WSZYSTKICH bloków (model_scores) niezależnie od excludeK0.
    const trainRawFull = await loadLabeledRows(db, params.trainWindows);
    checkAbort(ctx);
    const testRawFull = params.testWindows.length > 0 ? await loadLabeledRows(db, params.testWindows) : [];
    checkAbort(ctx);

    // trainForModel/testForModel: to, co faktycznie idzie do treningu/ewaluacji — opcjonalnie
    // po wykluczeniu k=0 (`params.excludeK0`, domyślnie false).
    const trainForModel = params.excludeK0 ? filterK0(trainRawFull) : trainRawFull;
    const testForModel = params.excludeK0 ? filterK0(testRawFull) : testRawFull;
    if (params.excludeK0) {
      const dropped = trainRawFull.length - trainForModel.length + (testRawFull.length - testForModel.length);
      await ctx.log(`excludeK0: odrzucono ${dropped} zweryfikowanych okazji z blocks_to_consumption=0`);
    }

    let rowsTrain: LabeledRow[];
    let rowsTest: LabeledRow[];
    if (params.testWindows.length > 0) {
      rowsTrain = trainForModel;
      rowsTest = testForModel;
    } else {
      await ctx.log("testWindows puste — odcięcie 20% chronologicznie z trainWindows (grupowo świadome, stratyfikowane po etykiecie)");
      const split = splitTrainTestByTime(trainForModel, 0.2);
      rowsTrain = split.train;
      rowsTest = split.test;
    }
    await ctx.progress(0.05);
    checkAbort(ctx);

    // Proweniencja liczona PRZED treningiem (liczności okien w tej chwili); `durationMs` jest
    // dociągnięty PO treningu poniżej (drugi `.parse`, tani), żeby objąć cały czas joba.
    const provenance = await collectProvenance(db, [...params.trainWindows, ...params.testWindows], startedAt);

    // `trainAnfis` czeka na ten callback po każdej epoce (i oddaje pętlę zdarzeń), więc log/progress
    // faktycznie trafiają do bazy W TRAKCIE treningu, a przerwanie sygnałem działa między epokami.
    // Zapis co EPOCH_REPORT_EVERY epok (i w ostatniej), żeby nie zalewać `jobs.log`.
    const { params: anfisParams, metrics: trainedMetrics } = await runTraining(
      rowsTrain,
      rowsTest,
      { seed: params.seed, epochs: params.epochs, lr: params.lr, trainWindows: params.trainWindows, testWindows: params.testWindows, provenance },
      async (e) => {
        checkAbort(ctx);
        if (e.epoch % EPOCH_REPORT_EVERY === 0 || e.epoch === params.epochs) {
          await ctx.log(`epoka ${e.epoch}: train=${e.trainLoss.toFixed(4)} val=${e.valLoss.toFixed(4)}`);
          await ctx.progress(0.05 + 0.55 * (e.epoch / params.epochs));
        }
      },
    );
    checkAbort(ctx);
    const metrics: AnfisMetrics = AnfisMetricsSchema.parse({
      ...trainedMetrics,
      provenance: { ...trainedMetrics.provenance, durationMs: Date.now() - startedAt },
    });
    await ctx.log(
      `Trening zakończony: najlepsza epoka ${metrics.bestEpoch}, AUC(train, zweryfikowane)=${metrics.population_verified.train.auc?.toFixed(3) ?? "—"}` +
        (metrics.population_verified.test ? `, AUC(test, zweryfikowane)=${metrics.population_verified.test.auc?.toFixed(3) ?? "—"}` : ""),
    );
    await ctx.progress(0.6);

    const name = params.name ?? "anfis";
    const [maxVersionRow] = await db
      .select({ maxVersion: sql<number>`coalesce(max(${scoringModels.version}), 0)` })
      .from(scoringModels)
      .where(sql`${scoringModels.name} = ${name}`);
    const version = Number(maxVersionRow!.maxVersion) + 1;

    const [row] = await db
      .insert(scoringModels)
      .values({ name, kind: "anfis", version, params: anfisParams, trainedOnWindowIds: params.trainWindows, metrics })
      .returning({ id: scoringModels.id });
    const modelId = row!.id;
    await ctx.log(`Model zapisany: scoring_models.id=${modelId} (${name} v${version})`);
    await ctx.progress(0.65);
    checkAbort(ctx);

    // model_scores dla WSZYSTKICH block_states okien trainWindows+testWindows (każda para) —
    // ZAWSZE z NIEfiltrowanych trainRawFull/testRawFull (loadLabeledRows zwraca jeden wiersz na
    // (pair_id, block) danego okna, niezależnie od tego, czy jest okazją) — ani excludeK0, ani
    // podział train/test/fallback nie mogą pomniejszyć zbioru ocenianych bloków.
    const scoreTargets = params.testWindows.length > 0 ? [...trainRawFull, ...testRawFull] : trainRawFull;
    const model = new AnfisModel(anfisParams);
    const scored: ModelScoreRow[] = scoreTargets.map((r) => {
      const s = model.score(toFeatures(r));
      return { modelId, pairId: r.pairId, block: r.block, score: s.score, label: s.label };
    });
    await writeModelScores(db, scored, async (done, total) => {
      checkAbort(ctx);
      await ctx.progress(0.65 + 0.35 * (total > 0 ? done / total : 1));
    });
    await ctx.log(`Oceniono ${scored.length} bloków (model_scores).`);
    await ctx.progress(1);
  };
}
