// Typy zadań kolejki, schematy zod ich parametrów oraz kontrakt JobContext/JobHandler
// współdzielony przez wszystkie etapy (ingest/import/analiza/weryfikacja/trening).
import { z } from "zod";

// JOB_TYPES niesie pełną listę typów zadań od początku, ale nie każdy typ od razu miał
// dedykowany schemat parametrów — dopóki dany handler nie istniał, jego parametry były
// placeholderem. Dziś wszystkie sześć typów ma właściwy schemat poniżej.
export const JOB_TYPES = [
  "ingest:pool-window",
  "import:csv",
  "analyze:pair-window",
  "verify:pair-window",
  "train",
  "calibrate:baseline_v2",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const ingestPoolWindowParams = z.object({
  poolId: z.number().int().positive(),
  windowId: z.number().int().positive(),
});
export const importCsvParams = z.object({
  path: z.string().min(1),
  // poolAliases: { uniswap: <pools.id>, sushiswap: <pools.id> } — mapowanie kolumny `pool` z CSV.
  poolAliases: z.record(z.string(), z.number().int().positive()),
});
export const analyzePairWindowParams = z.object({
  pairId: z.number().int().positive(),
  windowId: z.number().int().positive(),
});
// force: pomija domyślne pomijanie już zweryfikowanych okazji (skipVerified) — reweryfikuje
// wszystkie okazje pary/okna od nowa.
export const verifyPairWindowParams = z.object({
  pairId: z.number().int().positive(),
  windowId: z.number().int().positive(),
  force: z.boolean().optional(),
});

/**
 * Parametry zadania `train`: trenuje ANFIS na `trainWindows`, ewaluuje na
 * `testWindows` (gdy podane — inaczej worker robi 20% odcięcia chronologicznego z trainWindows,
 * GRUPOWO ŚWIADOME, patrz `runTraining`/`splitTrainTestByTime` w `@dex-arb/worker`), zapisuje
 * `scoring_models` + `model_scores`. `name` opcjonalne (worker domyślnie nadaje `'anfis'`,
 * wersjonując po kolei).
 */
export const trainParams = z.object({
  trainWindows: z.array(z.number().int().positive()).min(1),
  testWindows: z.array(z.number().int().positive()).default([]),
  name: z.string().min(1).max(80).optional(),
  seed: z.number().int().default(42),
  epochs: z.number().int().min(1).max(2000).default(200),
  lr: z.number().positive().max(1).default(0.01),
  /**
   * Addendum przeglądu etapu 4 (pkt 2): gdy `true`, odrzuca ze zbioru uczącego/ewaluacyjnego
   * zweryfikowane okazje z `blocks_to_consumption = 0` (`filterK0` w `@dex-arb/analysis`) —
   * `block_states` to stan na koniec bloku, więc k=0 mierzy „arb wykonany w tym samym bloku",
   * co jest innym reżimem niż k>0. Domyślnie `false` (nic nie jest odrzucane). Nie wpływa na
   * `model_scores` — worker ocenia WSZYSTKIE block_states okien niezależnie od tej flagi.
   */
  excludeK0: z.boolean().default(false),
});

/**
 * Parametry zadania `calibrate:baseline_v2` (baseline skalibrowany): siatka parametrów
 * kosztu gazu / wagi optTrade dobierana na zweryfikowanych okazjach `trainWindows`
 * (`calibrateBaselineV2` w `@dex-arb/core`), metryki kontrolne na `testWindows` (gdy podane —
 * inaczej brak holdoutu; kalibracja jest deterministyczna, więc podział wewnętrzny nie jest
 * potrzebny), zapis `scoring_models` (kind='baseline_v2') + `model_scores` dla WSZYSTKICH
 * block_states okien train+test — tak samo jak `train`. `name` domyślnie `'baseline_v2'`.
 */
export const calibrateBaselineV2Params = z.object({
  trainWindows: z.array(z.number().int().positive()).min(1),
  testWindows: z.array(z.number().int().positive()).default([]),
  name: z.string().min(1).max(80).optional(),
});

export const jobParamsByType = {
  "ingest:pool-window": ingestPoolWindowParams,
  "import:csv": importCsvParams,
  "analyze:pair-window": analyzePairWindowParams,
  "verify:pair-window": verifyPairWindowParams,
  train: trainParams,
  "calibrate:baseline_v2": calibrateBaselineV2Params,
} as const satisfies Record<JobType, z.ZodTypeAny>;

export type IngestPoolWindowParams = z.infer<typeof ingestPoolWindowParams>;
export type ImportCsvParams = z.infer<typeof importCsvParams>;
export type AnalyzePairWindowParams = z.infer<typeof analyzePairWindowParams>;
export type VerifyPairWindowParams = z.infer<typeof verifyPairWindowParams>;
export type TrainParams = z.infer<typeof trainParams>;
export type CalibrateBaselineV2Params = z.infer<typeof calibrateBaselineV2Params>;

// Mapowanie typu zadania -> typ jego sparsowanych parametrów (dla wywołań z literałem JobType).
type ParamsByType = { [K in JobType]: z.infer<(typeof jobParamsByType)[K]> };

// Kontrakt uzgodniony między etapami — implementacja kolejki (worker) dostarcza tę strukturę
// handlerom zadań; sygnał pozwala anulować długo trwające zadanie (np. ingest okna bloków).
export interface JobContext {
  jobId: number;
  log(msg: string): Promise<void>;
  progress(fraction: number): Promise<void>;
  signal: AbortSignal;
}
export type JobHandler<P> = (params: P, ctx: JobContext) => Promise<void>;

export function parseJobParams<T extends JobType>(type: T, params: unknown): ParamsByType[T];
export function parseJobParams(type: string, params: unknown): IngestPoolWindowParams | ImportCsvParams | Record<string, unknown>;
export function parseJobParams(type: string, params: unknown): unknown {
  const schema = (jobParamsByType as Record<string, z.ZodTypeAny | undefined>)[type];
  if (!schema) throw new Error(`Nieznany typ zadania: ${type}`);
  return schema.parse(params);
}
