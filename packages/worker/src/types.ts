// Typy współdzielone przez runner/handlers workera.
import type { JobHandler } from "@dex-arb/shared";
import type { schema } from "@dex-arb/db";

/** Rejestr handlerów wg typu zadania (klucz = jobs.type) — parametry różnią się typem między
 * zadaniami, więc rejestr celowo je wymazuje (runner.ts parsuje/przekazuje właściwy typ). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HandlerRegistry = Record<string, JobHandler<any>>;

/** Wiersz tabeli jobs (kształt zwracany przez Drizzle — camelCase). */
export type JobRow = typeof schema.jobs.$inferSelect;
