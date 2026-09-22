// DTO API dla modeli oceny — odpowiada `scoring_models` w `@dex-arb/db`
// (packages/db/src/schema/derived.ts); `kind` zgodny z `model_kind` DB enum.
import { z } from "zod";

/** Rodzaje modeli — zgodne z `model_kind` DB enum (`baseline_v2` = baseline skalibrowany, migracja 0006). */
export const MODEL_KINDS = z.enum(["baseline", "baseline_v2", "mamdani", "anfis"]);
export type ModelKind = z.infer<typeof MODEL_KINDS>;

export const ModelDto = z.object({
  id: z.number().int(),
  name: z.string(),
  kind: MODEL_KINDS,
  // integer w DB (scoring_models.version), nie string.
  version: z.number().int(),
  created_at: z.string(),
  /**
   * Skrót metryk ZADANIA TRENINGOWEGO (`scoring_models.metrics`, zapisywane przez
   * `packages/worker/src/jobs/train.ts` dla `kind='anfis'` i `calibrateBaselineV2.ts` dla
   * `kind='baseline_v2'`). Preferuje populację `'verified_opportunities'` — te same
   * zweryfikowane okazje co `GET /models/:id/evaluation` (ADR 0008); dla wierszy sprzed tego
   * podziału (klucze `train`/`test` na najwyższym poziomie `metrics`) spada do populacji
   * `'block_states'` — WSZYSTKICH `block_states` okien testowych (`test_windows`; gdy puste —
   * 20% grupowo świadomego, chronologicznego odcięcia z okien treningowych), tło bez okazji
   * jako klasa 0 — stąd AUC ≈ 0,999: odróżnienie „okazja vs brak okazji" jest tam trywialne.
   * To pole NIE jest porównywalne z `GET /models/:id/evaluation` (AUC ≈ 0,7 na populacji
   * `block_states` legacy); do porównania modeli służy ewaluacja, nie to pole.
   */
  training_metrics_summary: z
    .object({ population: z.enum(["block_states", "verified_opportunities"]), auc: z.number(), f1: z.number() })
    .optional(),
  /**
   * `scoring_models.params` — GET /models dołącza je TYLKO dla `kind='baseline_v2'` (kilka
   * interpretowalnych liczb: gasUnits, gasPriceFactor, threshold, weightOptTrade, scale,
   * optTradeQuantiles), żeby widok Modele mógł je pokazać; dla mamdani/anfis parametry są duże i
   * nieczytelne w liście — dostępne w bazie.
   */
  params: z.record(z.string(), z.unknown()).optional(),
});
export type ModelDto = z.infer<typeof ModelDto>;

export const ModelList = z.array(ModelDto);

/**
 * Body POST /models/anfis/train — kontrakt HTTP (snake_case jak pozostałe DTO API). Kontrakt
 * zadania w kolejce to osobny, camelCase `trainParams` w `shared/src/jobs.ts` (z pełnymi
 * wartościami domyślnymi); tu poza `train_windows` wszystko jest opcjonalne — trasa API uzupełnia
 * domyślne i tłumaczy klucze przed utworzeniem joba.
 */
export const TrainRequest = z.object({
  train_windows: z.array(z.number().int().positive()).min(1),
  test_windows: z.array(z.number().int().positive()).default([]),
  seed: z.number().int().optional(),
  epochs: z.number().int().min(1).max(2000).optional(),
  lr: z.number().positive().max(1).optional(),
  name: z.string().min(1).max(80).optional(),
  /** Mapuje na `excludeK0` zadania `train` (`packages/shared/src/jobs.ts`) — patrz jego
   * dokumentacja: odrzuca ze zbioru uczącego/ewaluacyjnego zweryfikowane okazje z
   * `blocks_to_consumption = 0`. Domyślnie brak (job handler sam przyjmuje `false`). */
  exclude_k0: z.boolean().optional(),
});
export type TrainRequest = z.infer<typeof TrainRequest>;

/**
 * Body POST /models/baseline_v2/calibrate — lustrzane do `TrainRequest` (snake_case), bez
 * hiperparametrów uczenia (kalibracja to deterministyczna siatka, patrz
 * `calibrateBaselineV2Params` w `../jobs.ts`).
 */
export const CalibrateBaselineV2Request = z.object({
  train_windows: z.array(z.number().int().positive()).min(1),
  test_windows: z.array(z.number().int().positive()).default([]),
  name: z.string().min(1).max(80).optional(),
});
export type CalibrateBaselineV2Request = z.infer<typeof CalibrateBaselineV2Request>;
