// Handler zadania `calibrate:baseline_v2` — „baseline skalibrowany": deterministyczna siatka
// parametrów kosztu gazu / wagi optTrade (`calibrateBaselineV2` w `@dex-arb/core`) dobierana na
// ZWERYFIKOWANYCH okazjach o znanej etykiecie (route ≠ 'multi') z `trainWindows`; metryki
// kontrolne na tak samo wybranych okazjach `testWindows`. Zapisuje nowy wiersz `scoring_models`
// (kind='baseline_v2') i ocenia WSZYSTKIE block_states okien trainWindows+testWindows do
// `model_scores` — dokładnie jak `train` (ANFIS), więc `GET /models/:id/evaluation` działa bez zmian.
//
// `metrics` niesie DWIE populacje ewaluacji (ADR 0008, wspólny kontrakt z `AnfisMetrics`):
// `population_block_states` (wszystkie bloki okna) i `population_verified` (zweryfikowane okazje o
// znanej etykiecie — ta sama populacja co `calibration`/`holdout` i `GET /models/:id/evaluation`).
import { sql } from "drizzle-orm";
import { schema, type Db } from "@dex-arb/db";
import {
  ARB_GAS,
  BaselineV2Model,
  calibrateBaselineV2,
  evaluateScores,
  featuresToBaselineV2Inputs,
  type BaselineV2CalibrationRow,
  type BaselineV2Inputs,
  type BaselineV2Params,
} from "@dex-arb/core";
import { collectProvenance, isVerifiedKnownOpportunity, loadLabeledRows, writeModelScores, type LabeledRow, type ModelScoreRow } from "@dex-arb/analysis";
import { BaselineV2MetricsSchema, type BaselineV2Metrics, type Provenance } from "@dex-arb/shared";
import type { CalibrateBaselineV2Params, JobContext, JobHandler } from "@dex-arb/shared";
import { evaluatePopulations } from "./evaluatePopulations.js";

const { scoringModels } = schema;

/** Próg score -> predicted (jak `SCORE_THRESHOLD` z `@dex-arb/core`, użyte w train.ts): score ≥ 50 ⇔ v ≥ params.threshold. */
const SCORE_THRESHOLD = 50;

/** `LabeledRow` -> wejście oceny baseline v2 (brutto, koszt gazu v1 z różnicy brutto − netto v1, optTrade) — to samo mapowanie co `BaselineV2Model.score(Features)`. */
export function toBaselineV2Inputs(r: LabeledRow): BaselineV2Inputs {
  return featuresToBaselineV2Inputs(r);
}

/** Zweryfikowane okazje o znanej etykiecie — populacja kalibracji i holdoutu. */
export function calibrationRows(rows: LabeledRow[]): BaselineV2CalibrationRow[] {
  return rows.filter(isVerifiedKnownOpportunity).map((r) => ({ ...toBaselineV2Inputs(r), label: r.label === 1 }));
}

export function evaluateHoldout(params: BaselineV2Params, rows: BaselineV2CalibrationRow[]): BaselineV2Metrics["holdout"] {
  if (rows.length === 0) return null;
  const model = new BaselineV2Model(params);
  const scores = rows.map((r) => model.scoreInputs(r).score);
  const actual = rows.map((r) => r.label);
  const ev = evaluateScores(scores, scores.map((s) => s >= SCORE_THRESHOLD), actual);
  return {
    n: ev.n,
    positives: ev.positives,
    auc: Number.isNaN(ev.auc) ? null : ev.auc,
    f1: ev.f1,
    precision: ev.precision,
    recall: ev.recall,
    confusion: ev.cm,
  };
}

/** Czysta część jobu (bez bazy) — testowalna z syntetycznymi `LabeledRow[]`. */
export function runCalibration(
  rowsTrain: LabeledRow[],
  rowsTest: LabeledRow[],
  windows: { trainWindows: number[]; testWindows: number[] },
  provenance: Provenance,
): { params: BaselineV2Params; metrics: BaselineV2Metrics } {
  // `arbGasRef` = gaz założony przez pipeline analizy w `baseline_net_profit_usd` (`ARB_GAS` w core,
  // `baselineNetProfitUsd` w analyzeWindow) — zapisany w params, żeby ocena nie zależała od stałej w kodzie.
  const cal = calibrateBaselineV2(calibrationRows(rowsTrain), { arbGasRef: ARB_GAS });
  const model = new BaselineV2Model(cal.params);
  const populations = evaluatePopulations((r) => model.scoreInputs(toBaselineV2Inputs(r)).score, rowsTrain, rowsTest);
  const metrics = BaselineV2MetricsSchema.parse({
    population: "verified_opportunities",
    calibration: cal.train,
    holdout: evaluateHoldout(cal.params, calibrationRows(rowsTest)),
    grid: cal.grid,
    trainWindows: windows.trainWindows,
    testWindows: windows.testWindows,
    ...populations,
    provenance,
  });
  return { params: cal.params, metrics };
}

function checkAbort(ctx: JobContext): void {
  if (ctx.signal.aborted) throw new Error("Przerwano");
}

export function makeCalibrateBaselineV2({ db }: { db: Db }): JobHandler<CalibrateBaselineV2Params> {
  return async (params, ctx) => {
    const startedAt = Date.now();
    await ctx.log(`Wczytywanie danych: trainWindows=[${params.trainWindows.join(",")}] testWindows=[${params.testWindows.join(",")}]`);
    const trainRows = await loadLabeledRows(db, params.trainWindows);
    checkAbort(ctx);
    const testRows = params.testWindows.length > 0 ? await loadLabeledRows(db, params.testWindows) : [];
    checkAbort(ctx);
    await ctx.progress(0.2);

    const provenance = await collectProvenance(db, [...params.trainWindows, ...params.testWindows], startedAt);
    const { params: v2Params, metrics: calibratedMetrics } = runCalibration(trainRows, testRows, { trainWindows: params.trainWindows, testWindows: params.testWindows }, provenance);
    // `durationMs` dociągnięty PO kalibracji (drugi `.parse`, tani) — patrz analogiczny komentarz w train.ts.
    const metrics: BaselineV2Metrics = BaselineV2MetricsSchema.parse({
      ...calibratedMetrics,
      provenance: { ...calibratedMetrics.provenance, durationMs: Date.now() - startedAt },
    });
    await ctx.log(
      `Kalibracja: n=${metrics.calibration.n} (pozytywów ${metrics.calibration.positives}), wybrano gasUnits=${v2Params.gasUnits}, ` +
        `gasPriceFactor=${v2Params.gasPriceFactor}, weightOptTrade=${v2Params.weightOptTrade}, threshold=${v2Params.threshold.toFixed(4)}; ` +
        `AUC(kalibracja)=${metrics.calibration.auc.toFixed(3)}, F1=${metrics.calibration.f1.toFixed(3)}` +
        (metrics.holdout ? `; holdout n=${metrics.holdout.n}, AUC=${metrics.holdout.auc?.toFixed(3) ?? "—"}, F1=${metrics.holdout.f1.toFixed(3)}` : ""),
    );
    await ctx.progress(0.5);
    checkAbort(ctx);

    const name = params.name ?? "baseline_v2";
    const [maxVersionRow] = await db
      .select({ maxVersion: sql<number>`coalesce(max(${scoringModels.version}), 0)` })
      .from(scoringModels)
      .where(sql`${scoringModels.name} = ${name}`);
    const version = Number(maxVersionRow!.maxVersion) + 1;
    const [row] = await db
      .insert(scoringModels)
      .values({ name, kind: "baseline_v2", version, params: v2Params, trainedOnWindowIds: params.trainWindows, metrics })
      .returning({ id: scoringModels.id });
    const modelId = row!.id;
    await ctx.log(`Model zapisany: scoring_models.id=${modelId} (${name} v${version})`);
    await ctx.progress(0.55);
    checkAbort(ctx);

    // model_scores dla WSZYSTKICH block_states okien train+test (jak `train`).
    const model = new BaselineV2Model(v2Params);
    const scored: ModelScoreRow[] = [...trainRows, ...testRows].map((r) => {
      const s = model.scoreInputs(toBaselineV2Inputs(r));
      return { modelId, pairId: r.pairId, block: r.block, score: s.score, label: s.label };
    });
    await writeModelScores(db, scored, async (done, total) => {
      checkAbort(ctx);
      await ctx.progress(0.55 + 0.45 * (total > 0 ? done / total : 1));
    });
    await ctx.log(`Oceniono ${scored.length} bloków (model_scores).`);
    await ctx.progress(1);
  };
}
