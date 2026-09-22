// DTO API dla ewaluacji modelu — odpowiedź GET
// /models/:id/evaluation?window=<id>. Liczona z `model_scores ⋈ block_states ⋈ opportunities
// ⋈ opportunity_verifications`; etykieta pozytywna to `profitable_consumed` na zweryfikowanych
// okazjach danego okna (bloki bez okazji liczą się jako 0, okazje niezweryfikowane są
// pomijane). Pola snake_case jak pozostałe DTO API.
//
// To jest kontrakt HTTP, NIE ten sam typ co wewnętrzne `ModelEvaluation`/`AnfisMetrics`
// (`packages/worker/src/jobs/train.ts`) — trasa API liczy `EvaluationDto` z zapytania SQL
// (dowolny `kind` modelu), a dla `kind: 'anfis'` dokłada `history`/`class_weights`/
// `trained_on_window_ids` odczytane z zapisanych `AnfisMetrics` tego modelu.
import { z } from "zod";
import { MODEL_KINDS } from "./models.js";

/** Model, dla którego liczona jest ewaluacja — podzbiór ModelDto (bez created_at/training_metrics_summary). */
export const EvaluationModelRef = z.object({
  id: z.number().int(),
  name: z.string(),
  kind: MODEL_KINDS,
  version: z.number().int(),
});
export type EvaluationModelRef = z.infer<typeof EvaluationModelRef>;

/** Okno, dla którego liczona jest ewaluacja — `null` oznacza "wszystkie zweryfikowane okna". */
export const EvaluationWindowRef = z.object({
  id: z.number().int(),
  name: z.string(),
});
export type EvaluationWindowRef = z.infer<typeof EvaluationWindowRef>;

export const ConfusionMatrixDto = z.object({
  tp: z.number().int().nonnegative(),
  fp: z.number().int().nonnegative(),
  tn: z.number().int().nonnegative(),
  fn: z.number().int().nonnegative(),
});
export type ConfusionMatrixDto = z.infer<typeof ConfusionMatrixDto>;

export const RocCurveDto = z
  .object({
    fpr: z.array(z.number()),
    tpr: z.array(z.number()),
  })
  // Punkty krzywej ROC są parami (fpr[i], tpr[i]) — długości muszą się zgadzać, inaczej to nie
  // jest krzywa.
  .refine((v) => v.fpr.length === v.tpr.length, {
    message: "roc.fpr i roc.tpr muszą mieć tę samą długość",
    path: ["tpr"],
  });
export type RocCurveDto = z.infer<typeof RocCurveDto>;

/** `edges.length === positive.length + 1 === negative.length + 1`. */
export const ScoreHistogramDto = z
  .object({
    edges: z.array(z.number()),
    positive: z.array(z.number().int().nonnegative()),
    negative: z.array(z.number().int().nonnegative()),
  })
  // Histogram ma `bins` kubełków i `bins + 1` krawędzi.
  .refine((v) => v.edges.length === v.positive.length + 1 && v.edges.length === v.negative.length + 1, {
    message: "histogram.edges.length musi być równe histogram.positive.length + 1 i histogram.negative.length + 1",
    path: ["edges"],
  });
export type ScoreHistogramDto = z.infer<typeof ScoreHistogramDto>;

export const ClassWeightsDto = z.object({ pos: z.number(), neg: z.number() });
export type ClassWeightsDto = z.infer<typeof ClassWeightsDto>;

export const TrainingHistoryPointDto = z.object({
  epoch: z.number().int(),
  train_loss: z.number(),
  val_loss: z.number(),
});
export type TrainingHistoryPointDto = z.infer<typeof TrainingHistoryPointDto>;

export const EvaluationDto = z.object({
  model: EvaluationModelRef,
  window: EvaluationWindowRef.nullable(),
  n: z.number().int().nonnegative(),
  n_positive: z.number().int().nonnegative(),
  confusion: ConfusionMatrixDto,
  precision: z.number().min(0).max(1),
  recall: z.number().min(0).max(1),
  f1: z.number().min(0).max(1),
  /** `null`, gdy AUC niepoliczalne (brak przykładów jednej z klas). */
  auc: z.number().min(0).max(1).nullable(),
  /** 95 % przedział ufności AUC — bootstrap stratyfikowany (1000 prób, seed 42, `bootstrapAucCi` w core); null gdy AUC null. */
  auc_ci95: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).nullable(),
  /** PR-AUC (average precision, interpolacja krokowa) — metryka właściwa przy 1–12 % pozytywów; null gdy brak pozytywów. */
  pr_auc: z.number().min(0).max(1).nullable(),
  /** Próg F1-optymalny dobrany na oknach TRENINGOWYCH modelu (`scoring_models.trained_on_window_ids`, ta sama populacja
   * zweryfikowanych okazji); nieobecny, gdy model nie ma okien treningowych albo zawierają jedną klasę. Ten sam algorytm
   * (`thresholdOptF1`) dla KAŻDEGO modelu — usuwa asymetrię wobec baseline_v2 (ADR 0006). */
  threshold_train_opt: z.number().min(0).max(100).optional(),
  roc: RocCurveDto,
  histogram: ScoreHistogramDto,
  /** Tylko dla `model.kind === 'anfis'` — wagi klas użyte przy treningu. */
  class_weights: ClassWeightsDto.optional(),
  /** Tylko dla `model.kind === 'anfis'` — krzywa uczenia (strata train/walidacja per epoka). */
  history: z.array(TrainingHistoryPointDto).optional(),
  /** Tylko dla `model.kind === 'anfis'` — okna, na których model był trenowany. */
  trained_on_window_ids: z.array(z.number().int()).optional(),
});
export type EvaluationDto = z.infer<typeof EvaluationDto>;
