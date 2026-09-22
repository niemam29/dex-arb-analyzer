// DTO API dla zadań kolejki — reużywa schematy parametrów zdefiniowane
// w `../jobs.ts`, żeby nie duplikować walidacji `poolId`/`windowId`/`pairId`/`path`.
// Uwaga: to inny plik niż `../jobs.ts` — ten zawiera DTO warstwy HTTP (żądanie/odpowiedź),
// tamten kontrakt kolejki (JobType/JobContext/parseJobParams) używany przez worker/ingest.
import { z } from "zod";
import { JOB_TYPES, jobParamsByType } from "../jobs.js";
import { JOB_STATUSES } from "../constants.js";

const id = z.number().int().positive();

/**
 * Body żądania utworzenia zadania (POST /jobs) — unia dyskryminowana po `type`; jeden wariant
 * na każdy typ z `JOB_TYPES`, params ze schematu z `jobParamsByType` (patrz `../jobs.ts`).
 */
export const JobCreate = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ingest:pool-window"), params: jobParamsByType["ingest:pool-window"] }),
  z.object({ type: z.literal("import:csv"), params: jobParamsByType["import:csv"] }),
  z.object({ type: z.literal("analyze:pair-window"), params: jobParamsByType["analyze:pair-window"] }),
  z.object({ type: z.literal("verify:pair-window"), params: jobParamsByType["verify:pair-window"] }),
  z.object({ type: z.literal("train"), params: jobParamsByType["train"] }),
  z.object({ type: z.literal("calibrate:baseline_v2"), params: jobParamsByType["calibrate:baseline_v2"] }),
]);
export type JobCreate = z.infer<typeof JobCreate>;

/**
 * Rekord zadania zwracany przez API (GET /jobs, GET /jobs/:id) — odpowiada `jobs` w
 * `@dex-arb/db` (packages/db/src/schema/jobs.ts); daty jako ISO string (JSON nie ma typu daty).
 * Pola snake_case (zgodnie z aliasami SQL pozostałych DTO API — konwencja repo, patrz
 * docs/konwencje.md); `params` zachowuje camelCase kluczy tak, jak są zapisane w bazie (poolId/windowId/…).
 */
export const JobDto = z.object({
  id,
  type: z.enum(JOB_TYPES),
  params: z.record(z.string(), z.unknown()),
  status: z.enum(JOB_STATUSES),
  progress: z.number().int().min(0).max(100),
  log: z.string(),
  error: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
});
export type JobDto = z.infer<typeof JobDto>;
export const JobList = z.array(JobDto);
