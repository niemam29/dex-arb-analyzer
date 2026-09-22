// Kontrakt `scoring_models.metrics` (jsonb) — WSPÓLNY dla writera (worker: `train`,
// `calibrate:baseline_v2` robią `.parse` przed insertem) i readera (api: `.safeParse` przy
// odczycie). Schematy `*ReadSchema` są luźniejsze: stare wiersze (sprzed proweniencji, z kluczami
// `train`/`test` na górze) pozostają czytelne; zapis wymaga pełnego kształtu.
import { z } from "zod";

/** `Infinity` nie przeżywa JSON.stringify (→ null); próg pierwszego punktu ROC to +∞.
 * `z.number()` w zod v4 odrzuca wartości nieskończone, więc dopuszczamy je jawnie literałem. */
const rocThreshold = z.preprocess((v) => (v === null ? Infinity : v), z.union([z.number(), z.literal(Infinity)]));

export const ProvenanceWindowSchema = z.object({
  id: z.number().int(),
  fromBlock: z.number().int().nullable(),
  toBlock: z.number().int().nullable(),
  blockStates: z.number().int().nonnegative(),
  opportunities: z.number().int().nonnegative(),
  verified: z.number().int().nonnegative(),
});

export const ProvenanceSchema = z.object({
  /** `git rev-parse HEAD` w chwili treningu; "unknown", gdy git niedostępny. */
  gitSha: z.string().min(1),
  nodeVersion: z.string().min(1),
  deps: z.object({ "@thi.ng/fuzzy": z.string(), "drizzle-orm": z.string() }),
  /** Zamaskowana etykieta hosta RPC (bez schematu, portu, ścieżki, poświadczeń) — `rpcHostFrom`
   * w `@dex-arb/db`: `"self-hosted"` dla IP/hosta prywatnego, albo domena z pierwszą etykietą
   * zamaskowaną `*` (np. `*.example.org`); null, gdy RPC_URL nie ustawiono. */
  rpcHost: z.string().regex(/^[A-Za-z0-9*.-]+$/, "rpcHost: tylko nazwa hosta").nullable(),
  windows: z.array(ProvenanceWindowSchema),
  durationMs: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const ModelEvaluationSchema = z.object({
  n: z.number().int().nonnegative(),
  positives: z.number().int().nonnegative(),
  threshold: z.number(),
  confusion: z.object({ tp: z.number().int(), fp: z.number().int(), fn: z.number().int(), tn: z.number().int() }),
  precision: z.number(),
  recall: z.number(),
  f1: z.number(),
  /** null, gdy AUC niepoliczalne (jedna klasa) — NaN nie przeżywa JSON. */
  auc: z.number().nullable(),
  roc: z.array(z.object({ fpr: z.number(), tpr: z.number(), threshold: rocThreshold })),
  histogram: z.object({ edges: z.array(z.number()), positive: z.array(z.number()), negative: z.array(z.number()) }),
});
export type ModelEvaluation = z.infer<typeof ModelEvaluationSchema>;

/** Dwie populacje ewaluacji (ADR 0008): `population_block_states` = wszystkie block_states okna
 * (tło jako klasa 0, AUC ≈ 0,99 — trywialne), `population_verified` = zweryfikowane okazje o
 * znanej etykiecie (route ≠ 'multi') — TA SAMA populacja co GET /models/:id/evaluation. */
export const PopulationPairSchema = z.object({ train: ModelEvaluationSchema, test: ModelEvaluationSchema.nullable() });

export const EpochStatSchema = z.object({ epoch: z.number().int(), trainLoss: z.number(), valLoss: z.number(), lr: z.number() });
export const DatasetMetaSchema = z.object({ nPos: z.number().int(), nNeg: z.number().int(), nBackground: z.number().int(), windows: z.array(z.number().int()), nSkippedUnknown: z.number().int() });
export const DatasetDiagnosticsSchema = z.object({ groups: z.number().int(), zeroGasConsumers: z.number().int(), estProfitNegativeButProfitable: z.number().int() });

export const AnfisMetricsSchema = z.object({
  population_block_states: PopulationPairSchema,
  population_verified: PopulationPairSchema,
  history: z.array(EpochStatSchema),
  bestEpoch: z.number().int(),
  dataset: DatasetMetaSchema,
  classWeights: z.object({ pos: z.number(), neg: z.number() }),
  seed: z.number().int(),
  trainWindows: z.array(z.number().int()),
  testWindows: z.array(z.number().int()),
  diagnostics: DatasetDiagnosticsSchema,
  nGroupsTrain: z.number().int(),
  provenance: ProvenanceSchema,
});
export type AnfisMetrics = z.infer<typeof AnfisMetricsSchema>;

const LegacyEvalSchema = z.object({ auc: z.number().nullable().optional(), f1: z.number().optional() }).passthrough();

/** Odczyt: wszystko opcjonalne + stare klucze `train`/`test` (populacja block_states sprzed ADR 0008). */
export const AnfisMetricsReadSchema = AnfisMetricsSchema.partial().extend({
  train: LegacyEvalSchema.optional(),
  test: LegacyEvalSchema.nullable().optional(),
  history: z.array(EpochStatSchema.partial({ lr: true })).optional(),
});
export type AnfisMetricsRead = z.infer<typeof AnfisMetricsReadSchema>;

export const BaselineV2CalibrationSchema = z.object({
  n: z.number().int(), positives: z.number().int(), auc: z.number(), f1: z.number(), precision: z.number(), recall: z.number(),
  thresholdNetUsd: z.number().nullable(),
});
export const BaselineV2HoldoutSchema = z.object({
  n: z.number().int(), positives: z.number().int(), auc: z.number().nullable(), f1: z.number(), precision: z.number(), recall: z.number(),
  confusion: z.object({ tp: z.number().int(), fp: z.number().int(), fn: z.number().int(), tn: z.number().int() }),
});
export const BaselineV2GridPointSchema = z.object({
  gasUnits: z.number(), gasPriceFactor: z.number(), weightOptTrade: z.number(), scale: z.number(), threshold: z.number(), auc: z.number(), f1: z.number(),
});

export const BaselineV2MetricsSchema = z.object({
  population: z.literal("verified_opportunities"),
  calibration: BaselineV2CalibrationSchema,
  holdout: BaselineV2HoldoutSchema.nullable(),
  grid: z.array(BaselineV2GridPointSchema),
  trainWindows: z.array(z.number().int()),
  testWindows: z.array(z.number().int()),
  population_block_states: PopulationPairSchema,
  population_verified: PopulationPairSchema,
  provenance: ProvenanceSchema,
});
export type BaselineV2Metrics = z.infer<typeof BaselineV2MetricsSchema>;

export const BaselineV2MetricsReadSchema = BaselineV2MetricsSchema.partial().extend({
  population: z.literal("verified_opportunities"),
  calibration: BaselineV2CalibrationSchema,
});
export type BaselineV2MetricsRead = z.infer<typeof BaselineV2MetricsReadSchema>;
