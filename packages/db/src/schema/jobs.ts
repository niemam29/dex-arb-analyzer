import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const jobTypeEnum = pgEnum("job_type", [
  "ingest:pool-window",
  "analyze:pair-window",
  "verify:pair-window",
  "import:csv",
  "train",
  // baseline skalibrowany (migracja 0006, ALTER TYPE ... ADD VALUE) — patrz `calibrateBaselineV2Params` w @dex-arb/shared
  "calibrate:baseline_v2",
]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "done", "failed"]);

/**
 * Zadania wykonywane sekwencyjnie przez worker (spec §4).
 * attempts: licznik prób wykonania (retry/backoff w workerze).
 */
export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    type: jobTypeEnum("type").notNull(),
    params: jsonb("params").notNull().default({}),
    status: jobStatusEnum("status").notNull().default("queued"),
    /** 0–100 */
    progress: integer("progress").notNull().default(0),
    log: text("log").notNull().default(""),
    /** komunikat błędu ostatniej nieudanej próby */
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    /**
     * Wymusza na poziomie bazy dedup zadań POST /jobs (API sprawdza duplikat SELECT-em przed
     * INSERT-em, ale dwa równoległe żądania mogą przejść ten SELECT jednocześnie — race
     * condition). Indeks unikalny częściowy: tylko wiersze `queued`/`running` uczestniczą
     * w ograniczeniu, więc te same (type, params) mogą pojawić się ponownie po `done`/`failed`.
     * btree na jsonb działa (porównanie całościowe wartości).
     */
    uniqueIndex("jobs_type_params_active_unique")
      .on(t.type, t.params)
      .where(sql`${t.status} IN ('queued', 'running')`),
    check("jobs_progress_range_check", sql`${t.progress} >= 0 AND ${t.progress} <= 100`),
  ],
);
