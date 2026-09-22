// Odczyt `scoring_models.metrics` (jsonb) przez zod (`AnfisMetricsReadSchema` z @dex-arb/shared —
// ten sam kontrakt, którym worker zapisuje). Wiersze sprzed proweniencji (klucze `train`/`test`
// na górze, populacja block_states) pozostają czytelne; nowe niosą `population_verified`, czyli tę
// samą populację co GET /models/:id/evaluation.
import { AnfisMetricsReadSchema, type AnfisMetricsRead } from "@dex-arb/shared";

function read(metrics: unknown): AnfisMetricsRead | null {
  const parsed = AnfisMetricsReadSchema.safeParse(metrics);
  return parsed.success ? parsed.data : null;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export type TrainingMetricsSummary = { population: "verified_opportunities" | "block_states"; auc: number; f1: number };

/** Skrót metryk treningowych do `ModelDto.training_metrics_summary` — preferuje populację zweryfikowanych okazji. */
export function metricsSummaryFrom(metrics: unknown): TrainingMetricsSummary | undefined {
  const m = read(metrics);
  if (!m) return undefined;
  const verified = m.population_verified?.test ?? m.population_verified?.train;
  if (verified && finite(verified.auc) && finite(verified.f1)) return { population: "verified_opportunities", auc: verified.auc, f1: verified.f1 };
  const legacy = m.test ?? m.train;
  if (legacy && finite(legacy.auc) && finite(legacy.f1)) return { population: "block_states", auc: legacy.auc, f1: legacy.f1 };
  return undefined;
}

export interface AnfisExtras {
  class_weights?: { pos: number; neg: number };
  history?: { epoch: number; train_loss: number; val_loss: number }[];
  trained_on_window_ids?: number[];
}

export function anfisExtrasFrom(metrics: unknown, trainedOnWindowIdsColumn: number[] | null): AnfisExtras {
  const extras: AnfisExtras = {};
  const m = read(metrics);
  if (m?.classWeights) extras.class_weights = { pos: m.classWeights.pos, neg: m.classWeights.neg };
  if (m?.history) extras.history = m.history.map((e) => ({ epoch: e.epoch, train_loss: e.trainLoss, val_loss: e.valLoss }));
  const trainedOn = trainedOnWindowIdsColumn ?? m?.trainWindows;
  if (Array.isArray(trainedOn) && trainedOn.every((v) => typeof v === "number")) extras.trained_on_window_ids = trainedOn;
  return extras;
}
