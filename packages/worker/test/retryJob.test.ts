// Test integracyjny `retryJob` (brama status='failed' i reset
// finished_at/progress). Ta sama brama co API
// POST /jobs/:id/retry (packages/api/src/routes/jobs.ts) — retry tylko ze statusu 'failed'.
// Uruchomienie: DATABASE_URL_TEST=postgres://dexarb:dexarb@localhost:5433/dexarb_test npx vitest run packages/worker
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { eq, sql } from "drizzle-orm";
import { retryJob, RetryNotAllowedError } from "../src/retryJob.js";

const HAS_DB = Boolean(process.env.DATABASE_URL_TEST);

describe.skipIf(!HAS_DB)("retryJob", () => {
  let db: Db;
  let closeDb: () => Promise<void>;

  beforeAll(() => {
    const conn = createTestDb();
    db = conn.db;
    closeDb = () => conn.sql.end();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE jobs RESTART IDENTITY`);
  });

  it("ze statusu failed: status='queued', attempts=0, error=null, finished_at=null, progress=0, log zostaje", async () => {
    const [job] = await db
      .insert(schema.jobs)
      .values({
        type: "import:csv",
        params: { path: "x", poolAliases: {} },
        status: "failed",
        attempts: 3,
        error: "błąd RPC",
        progress: 42,
        log: "linia loga\n",
        finishedAt: new Date(),
      })
      .returning();

    await retryJob(db, job!.id);

    const [after] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job!.id));
    expect(after).toMatchObject({ status: "queued", attempts: 0, error: null, progress: 0, log: "linia loga\n" });
    expect(after!.finishedAt).toBeNull();
  });

  it("odrzuca zadanie ze statusu innego niż failed (queued/running/done) — komunikat po polsku, wiersz bez zmian", async () => {
    for (const status of ["queued", "running", "done"] as const) {
      // params różne per status: unikalny indeks częściowy (type, params) WHERE status IN
      // (queued, running) odrzuciłby drugi wiersz o identycznych params (migracja 0003).
      const [job] = await db
        .insert(schema.jobs)
        .values({ type: "import:csv", params: { path: `x-${status}`, poolAliases: {} }, status, progress: 7 })
        .returning();

      await expect(retryJob(db, job!.id)).rejects.toThrow(RetryNotAllowedError);
      await expect(retryJob(db, job!.id)).rejects.toThrow(/failed/);

      const [after] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job!.id));
      expect(after).toMatchObject({ status, progress: 7 });
    }
  });

  it("nieistniejące id — błąd", async () => {
    await expect(retryJob(db, 999999)).rejects.toThrow(RetryNotAllowedError);
  });
});
