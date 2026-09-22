// Ewaluacja modelu na zweryfikowanych okazjach — JEDYNA implementacja, używana przez
// GET /models/:id/evaluation i skrypt `export-results` (te same liczby w API, w tabelach pracy i
// w LaTeX-ie). Populacja (ADR 0008): opportunity_verifications ⋈ opportunities, wszystkie pary,
// `route IS NULL OR route <> 'multi'` (trasa 'multi' = zysk nieznany = etykieta nieokreślona),
// wynik modelu z model_scores po (pair_id, block); wiersze bez wyniku wykluczone (raportowane przez n).
// Warianty populacji (`PopulationVariant`) służą WYŁĄCZNIE analizie wrażliwości
// (`export-results --sensitivity-only`, `results/evaluation-sensitivity.*`) — API i tabela główna
// zawsze używają wariantu `full`.
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@dex-arb/db";
import { SCORE_THRESHOLD, averagePrecision, bootstrapAucCi, evaluateScores, rocCurve, thresholdOptF1 } from "@dex-arb/core";
import { EvaluationDto, type ModelKind } from "@dex-arb/shared";
import { anfisExtrasFrom } from "../anfisMetrics.js";

export interface ScoringModelRow {
  id: number;
  name: string;
  kind: ModelKind;
  version: number;
  metrics: unknown;
  trained_on_window_ids: number[] | null;
}

export async function loadModelRow(db: Db, id: number): Promise<ScoringModelRow | undefined> {
  const rows = (await db.execute(sql`
    SELECT id, name, kind, version, metrics, trained_on_window_ids FROM scoring_models WHERE id = ${id}
  `)) as unknown as ScoringModelRow[];
  return rows[0];
}

export async function loadWindowRef(db: Db, id: number): Promise<{ id: number; name: string } | undefined> {
  const rows = (await db.execute(sql`SELECT id, name FROM windows WHERE id = ${id}`)) as unknown as { id: number; name: string }[];
  return rows[0];
}

/**
 * Wariant populacji ewaluacji (analiza wrażliwości protokołu na definicję pozytywów,
 * `docs/methodology.md` §4–5). Każdy wariant to populacja z ADR 0008 z DODATKOWYM ograniczeniem;
 * negatywy (`consumed_partial`, `decayed`, `persisted`) pozostają w każdym wariancie bez zmian.
 * - `full` — populacja referencyjna, bez dodatkowego ograniczenia (= tabela główna).
 * - `exclude_k0` — bez konsumpcji w tym samym bloku co okazja (`consumed_atomic ∧ k = 0`);
 *   odpowiednik `filterK0` z `packages/analysis/src/anfis/dataset.ts` (`trainParams.excludeK0`),
 *   które działa tylko na zbiorze treningowym ANFIS, nie na populacji ewaluacji.
 * - `bot_first` — z konsumpcji `consumed_atomic`/`two_pool` zostają tylko te, w których tx
 *   konsumująca była PIERWSZYM swapem bloku `B+k` w pulach tej pary (żaden swap innej tx nie ma
 *   `log_index` niższego niż najniższy `log_index` swapów tej tx w tym bloku) i `k ≥ 1`; pozostałe
 *   konsumpcje `two_pool` (bot nie pierwszy albo `k = 0`) mają etykietę NIEOKREŚLONĄ i są
 *   wykluczone z populacji (analogicznie do `route = 'multi'`).
 */
export type PopulationVariant = "full" | "exclude_k0" | "bot_first";

/** Kolejność = kolejność w tabeli wrażliwości (referencja pierwsza). Definicje zdaniem — do nagłówka MD/LaTeX. */
export const POPULATION_VARIANTS: readonly { key: PopulationVariant; label: string; definition: string }[] = [
  { key: "full", label: "pełna", definition: "populacja referencyjna z ADR 0008 (zweryfikowane okazje o znanej etykiecie, `route IS NULL OR route <> 'multi'`), identyczna z tabelą główną." },
  { key: "exclude_k0", label: "bez k=0", definition: "populacja pełna bez konsumpcji atomowych w tym samym bloku co okazja (`status = consumed_atomic` i `blocks_to_consumption = 0`)." },
  { key: "bot_first", label: "bot pierwszy", definition: "populacja pełna, w której z konsumpcji `consumed_atomic`/`two_pool` zostają wyłącznie te z `k ≥ 1`, gdzie tx konsumująca była pierwszym swapem bloku B+k w obu pulach pary (żaden swap innej tx w pulach tej pary nie ma niższego `log_index`); pozostałe konsumpcje `two_pool` są wykluczone jako etykieta nieokreślona, negatywy bez zmian." },
];

/** Dodatkowy warunek WHERE wariantu (aliasy: `ov` = opportunity_verifications, `o` = opportunities); `full` = brak. */
function populationCondition(variant: PopulationVariant): SQL {
  switch (variant) {
    case "full":
      return sql``;
    case "exclude_k0":
      return sql`AND NOT (ov.status = 'consumed_atomic' AND ov.blocks_to_consumption = 0)`;
    case "bot_first":
      // Blok konsumpcji = o.block + k; swapy tx konsumującej i obcych tx liczone tylko w pulach TEJ pary
      // (`pools.pair_id`) — `log_index` jest unikalny w obrębie bloku, więc porównanie między pulami jest poprawne.
      return sql`AND (
        ov.status <> 'consumed_atomic'
        OR (
          ov.blocks_to_consumption >= 1
          AND NOT EXISTS (
            SELECT 1
            FROM swap_events se
            JOIN pools p ON p.id = se.pool_id AND p.pair_id = o.pair_id
            WHERE se.block = o.block + ov.blocks_to_consumption
              AND se.tx_hash <> ov.consumer_tx_hash
              AND se.log_index < (
                SELECT min(own.log_index)
                FROM swap_events own
                JOIN pools po ON po.id = own.pool_id AND po.pair_id = o.pair_id
                WHERE own.block = o.block + ov.blocks_to_consumption AND own.tx_hash = ov.consumer_tx_hash
              )
          )
        )
      )`;
  }
}

export async function loadLabeledScores(
  db: Db,
  modelId: number,
  windowIds: number[] | null,
  variant: PopulationVariant = "full",
): Promise<{ score: number; profitable: boolean }[]> {
  if (windowIds !== null && windowIds.length === 0) return [];
  // `= ANY(tablica)` nie działa z drizzle/postgres-js (tablica JS wiązana jako rekord) — lista przez sql.join,
  // jak w `assertPoolsExist` (jobs.ts).
  const where = windowIds === null ? sql`` : sql`AND o.window_id IN (${sql.join(windowIds.map((w) => sql`${w}`), sql`, `)})`;
  const rows = (await db.execute(sql`
    SELECT ov.profitable_consumed AS profitable, ms.score AS score
    FROM opportunity_verifications ov
    JOIN opportunities o ON o.id = ov.opportunity_id
    JOIN model_scores ms ON ms.model_id = ${modelId} AND ms.pair_id = o.pair_id AND ms.block = o.block
    WHERE (ov.route IS NULL OR ov.route <> 'multi')
    ${populationCondition(variant)}
    ${where}
  `)) as unknown as { profitable: boolean; score: number }[];
  return rows;
}

export type EvaluationMetrics = Pick<EvaluationDto, "n" | "n_positive" | "confusion" | "precision" | "recall" | "f1" | "auc" | "auc_ci95" | "pr_auc" | "roc" | "histogram">;

export interface EvaluationOptions {
  threshold?: number;
  bootstrapN?: number;
  seed?: number;
}

/** Czysta część: metryki z tablic score/etykieta. `bootstrapN` obniżany w testach (domyślnie 1000). */
export function computeEvaluationMetrics(scores: number[], actual: boolean[], opts: EvaluationOptions = {}): EvaluationMetrics {
  const { threshold = SCORE_THRESHOLD, bootstrapN = 1000, seed = 42 } = opts;
  const predicted = scores.map((s) => s >= threshold);
  const ev = evaluateScores(scores, predicted, actual);
  const curve = rocCurve(scores, actual);
  const nPositive = actual.filter(Boolean).length;
  const ap = averagePrecision(scores, actual);
  return {
    n: scores.length,
    n_positive: nPositive,
    confusion: ev.cm,
    precision: ev.precision,
    recall: ev.recall,
    f1: ev.f1,
    auc: Number.isNaN(ev.auc) ? null : ev.auc,
    auc_ci95: bootstrapAucCi(scores, actual, { n: bootstrapN, seed }),
    pr_auc: Number.isNaN(ap) ? null : ap,
    roc: { fpr: curve.fpr, tpr: curve.tpr },
    histogram: { edges: ev.histogram.edges, positive: ev.histogram.positive, negative: ev.histogram.negative },
  };
}

/** Pełna odpowiedź `EvaluationDto` dla modelu i okna (null = wszystkie okna). `variant` (domyślnie `full`)
 * ogranicza populację — także dla `threshold_train_opt` — tylko w analizie wrażliwości; API go nie przekazuje. */
export async function evaluateModelOnWindow(
  db: Db,
  model: ScoringModelRow,
  window: { id: number; name: string } | null,
  variant: PopulationVariant = "full",
): Promise<EvaluationDto> {
  const rows = await loadLabeledScores(db, model.id, window ? [window.id] : null, variant);
  const metrics = computeEvaluationMetrics(
    rows.map((r) => r.score),
    rows.map((r) => r.profitable),
  );

  // Próg F1-optymalny na oknach TRENINGOWYCH modelu — to samo kryterium dla każdego modelu (ADR 0006).
  let thresholdTrainOpt: number | undefined;
  const trainWindows = model.trained_on_window_ids ?? [];
  if (trainWindows.length > 0) {
    const trainRows = await loadLabeledScores(db, model.id, trainWindows, variant);
    const nPos = trainRows.filter((r) => r.profitable).length;
    if (nPos > 0 && nPos < trainRows.length) {
      thresholdTrainOpt = thresholdOptF1(
        trainRows.map((r) => r.score),
        trainRows.map((r) => r.profitable),
      ).threshold;
    }
  }

  const extras = model.kind === "anfis" ? anfisExtrasFrom(model.metrics, model.trained_on_window_ids) : {};
  return EvaluationDto.parse({
    model: { id: model.id, name: model.name, kind: model.kind, version: model.version },
    window,
    ...metrics,
    ...(thresholdTrainOpt !== undefined ? { threshold_train_opt: thresholdTrainOpt } : {}),
    ...extras,
  });
}
