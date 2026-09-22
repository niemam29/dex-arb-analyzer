// Dwie populacje ewaluacji modelu (ADR 0008), liczone TĄ SAMĄ funkcją co API (`evaluateScores` z
// core): `population_block_states` — wszystkie bloki okna o znanej etykiecie (tło = 0), gdzie
// odróżnienie „okazja vs brak okazji" jest trywialne (AUC ≈ 0,99); `population_verified` —
// zweryfikowane okazje o znanej etykiecie (route ≠ 'multi'), czyli populacja GET /models/:id/evaluation.
import { SCORE_THRESHOLD, evaluateScores, rocCurve } from "@dex-arb/core";
import { isVerifiedKnownOpportunity, type LabeledRow } from "@dex-arb/analysis";
import type { ModelEvaluation } from "@dex-arb/shared";

/** Wiersz o ZNANEJ etykiecie: tło (0 z definicji) albo zweryfikowana okazja z trasą ≠ 'multi'. */
export function hasKnownLabel(r: LabeledRow): boolean {
  if (!r.isOpportunity) return true;
  return isVerifiedKnownOpportunity(r);
}

export function evaluateRows(scoreOf: (r: LabeledRow) => number, rows: LabeledRow[], threshold: number = SCORE_THRESHOLD): ModelEvaluation {
  const scores = rows.map(scoreOf);
  const actual = rows.map((r) => r.isOpportunity && r.label === 1);
  const ev = evaluateScores(scores, scores.map((s) => s >= threshold), actual);
  const curve = rocCurve(scores, actual);
  return {
    n: rows.length,
    positives: ev.positives,
    threshold,
    confusion: ev.cm,
    precision: ev.precision,
    recall: ev.recall,
    f1: ev.f1,
    auc: Number.isNaN(ev.auc) ? null : ev.auc,
    roc: curve.fpr.map((fpr, i) => ({ fpr, tpr: curve.tpr[i]!, threshold: curve.thresholds[i]! })),
    histogram: { edges: ev.histogram.edges, positive: ev.histogram.positive, negative: ev.histogram.negative },
  };
}

export interface Populations {
  population_block_states: { train: ModelEvaluation; test: ModelEvaluation | null };
  population_verified: { train: ModelEvaluation; test: ModelEvaluation | null };
}

export function evaluatePopulations(scoreOf: (r: LabeledRow) => number, rowsTrain: LabeledRow[], rowsTest: LabeledRow[]): Populations {
  const known = (rows: LabeledRow[]) => rows.filter(hasKnownLabel);
  const verified = (rows: LabeledRow[]) => rows.filter(isVerifiedKnownOpportunity);
  return {
    population_block_states: { train: evaluateRows(scoreOf, known(rowsTrain)), test: rowsTest.length > 0 ? evaluateRows(scoreOf, known(rowsTest)) : null },
    population_verified: { train: evaluateRows(scoreOf, verified(rowsTrain)), test: rowsTest.length > 0 ? evaluateRows(scoreOf, verified(rowsTest)) : null },
  };
}
