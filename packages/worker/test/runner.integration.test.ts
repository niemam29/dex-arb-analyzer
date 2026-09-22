// Test integracyjny pętli workera na realnym Postgresie: claim FOR UPDATE SKIP LOCKED,
// zapis log/progress, retry z backoffem, failed po wyczerpaniu prób, nieznany typ/złe parametry.
// Uruchomienie: DATABASE_URL_TEST=postgres://dexarb:dexarb@localhost:5433/dexarb_test npx vitest run packages/worker
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { eq, sql } from "drizzle-orm";
import { claimNextJob, requeueOrphanedJobs, runJob, runLoop } from "../src/runner.js";
import type { HandlerRegistry } from "../src/types.js";

// WYŁĄCZNIE DATABASE_URL_TEST (nigdy DATABASE_URL) — testy robią TRUNCATE, niebezpieczne poza bazą testową.
const HAS_DB = Boolean(process.env.DATABASE_URL_TEST);
const noAbort = new AbortController().signal;

describe.skipIf(!HAS_DB)("worker runner", () => {
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

  it("claimNextJob bierze najstarsze queued i oznacza running; brak zadań → null", async () => {
    expect(await claimNextJob(db)).toBeNull();
    await db.insert(schema.jobs).values([
      { type: "import:csv", params: { n: 1 } },
      { type: "import:csv", params: { n: 2 } },
    ]);
    const j = await claimNextJob(db);
    expect(j?.params).toEqual({ n: 1 });
    expect(j?.status).toBe("running");
    expect(j?.attempts).toBe(1);
    expect(j?.startedAt).not.toBeNull();
  });

  it("claimNextJob pomija zablokowane/nie-queued wiersze (FOR UPDATE SKIP LOCKED)", async () => {
    await db.insert(schema.jobs).values([
      { type: "import:csv", params: { path: "a", poolAliases: {} }, status: "running" },
      { type: "import:csv", params: { path: "b", poolAliases: {} } },
    ]);
    const j = await claimNextJob(db);
    expect(j?.params).toEqual({ path: "b", poolAliases: {} });
  });

  it("sukces → done, log i progress zapisane", async () => {
    const [job] = await db
      .insert(schema.jobs)
      .values({ type: "import:csv", params: { path: "x", poolAliases: {} } })
      .returning();
    const claimed = (await claimNextJob(db))!;
    const handlers: HandlerRegistry = {
      "import:csv": async (_p, ctx) => {
        await ctx.log("hej");
        await ctx.progress(0.5);
      },
    };
    const res = await runJob(db, claimed, handlers, { maxAttempts: 3, signal: noAbort });
    expect(res).toBe("done");

    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job!.id));
    expect(row!.status).toBe("done");
    expect(row!.progress).toBe(100);
    expect(row!.log).toMatch(/\[\d\d:\d\d:\d\d\] hej/);
    expect(row!.finishedAt).not.toBeNull();
    expect(row!.error).toBeNull();
  });

  it("wyjątek → requeued do maxAttempts, potem failed z error", async () => {
    await db.insert(schema.jobs).values({ type: "import:csv", params: { path: "x", poolAliases: {} } });
    const boom: HandlerRegistry = {
      "import:csv": async () => {
        throw new Error("awaria");
      },
    };
    expect(await runJob(db, (await claimNextJob(db))!, boom, { maxAttempts: 2, signal: noAbort })).toBe("requeued");
    let [row] = await db.select().from(schema.jobs);
    expect(row!.status).toBe("queued");
    expect(row!.attempts).toBe(1);
    expect(row!.log).toMatch(/próba 1\/2 nieudana: awaria; ponawiam/);

    expect(await runJob(db, (await claimNextJob(db))!, boom, { maxAttempts: 2, signal: noAbort })).toBe("failed");
    [row] = await db.select().from(schema.jobs);
    expect(row!.status).toBe("failed");
    expect(row!.attempts).toBe(2);
    expect(row!.error).toMatch(/awaria/);
    expect(row!.finishedAt).not.toBeNull();
  });

  it("złe parametry → failed od razu (bez retry)", async () => {
    await db.insert(schema.jobs).values({ type: "ingest:pool-window", params: { poolId: "zły" } });
    const res = await runJob(db, (await claimNextJob(db))!, {}, { maxAttempts: 3, signal: noAbort });
    expect(res).toBe("failed");
    const [row] = await db.select().from(schema.jobs);
    expect(row!.status).toBe("failed");
    expect(row!.attempts).toBe(1);
    expect(row!.error).toMatch(/nieprawidłowe parametry/);
  });

  it("typ bez zarejestrowanego handlera w podanym rejestrze → failed z komunikatem 'brak handlera'", async () => {
    // `train` ma właściwy schemat i handler — parametry muszą być
    // poprawne (inaczej zawiedzie wcześniej, na parsowaniu), a "niezarejestrowany" symulujemy
    // podając PUSTY rejestr handlerów (`{}`), nie `buildHandlers(db)`.
    await db.insert(schema.jobs).values({ type: "train", params: { trainWindows: [1] } });
    const res = await runJob(db, (await claimNextJob(db))!, {}, { maxAttempts: 3, signal: noAbort });
    expect(res).toBe("failed");
    const [row] = await db.select().from(schema.jobs);
    expect(row!.status).toBe("failed");
    expect(row!.error).toMatch(/brak handlera/);
  });

  it("runLoop przetwarza zadania aż do abortu", async () => {
    await db.insert(schema.jobs).values([
      { type: "import:csv", params: { path: "x", poolAliases: {} } },
      { type: "import:csv", params: { path: "y", poolAliases: {} } },
    ]);
    const ac = new AbortController();
    let n = 0;
    const handlers: HandlerRegistry = {
      "import:csv": async () => {
        if (++n === 2) ac.abort();
      },
    };
    await runLoop(db, handlers, { pollMs: 10, maxAttempts: 1, signal: ac.signal });
    const done = await db.select().from(schema.jobs).where(eq(schema.jobs.status, "done"));
    expect(done.length).toBe(2);
  });

  // Ścieżka odzyskiwania po twardej awarii workera (zadanie zostaje "running" na zawsze bez tego).
  it("requeueOrphanedJobs: zadanie osierocone (running po twardej awarii) wraca do queued bez zmiany attempts", async () => {
    await db.insert(schema.jobs).values([
      { type: "import:csv", params: { path: "x", poolAliases: {} }, status: "running", attempts: 1 },
      { type: "import:csv", params: { path: "y", poolAliases: {} }, status: "queued" },
      { type: "import:csv", params: { path: "z", poolAliases: {} }, status: "done", attempts: 1 },
    ]);
    const n = await requeueOrphanedJobs(db);
    expect(n).toBe(1);

    const rows = await db.select().from(schema.jobs).orderBy(schema.jobs.id);
    expect(rows[0]!.status).toBe("queued");
    expect(rows[0]!.attempts).toBe(1); // niezmienione — to nie była nieudana próba
    expect(rows[1]!.status).toBe("queued"); // już queued — bez zmian
    expect(rows[2]!.status).toBe("done"); // done — poza zakresem zamiatania
  });

  it("przerwanie sygnałem (SIGTERM/SIGINT) nie liczy się jako nieudana próba — attempts wraca do stanu sprzed claimu, log 'przerwano sygnałem'", async () => {
    await db.insert(schema.jobs).values({ type: "import:csv", params: { path: "x", poolAliases: {} } });
    const claimed = (await claimNextJob(db))!; // attempts: 0 -> 1
    expect(claimed.attempts).toBe(1);

    const ac = new AbortController();
    const handlers: HandlerRegistry = {
      "import:csv": async (_p, ctx) => {
        ac.abort(); // symuluje SIGTERM w trakcie wykonywania zadania
        if (ctx.signal.aborted) throw new Error("Przerwano");
      },
    };
    const res = await runJob(db, claimed, handlers, { maxAttempts: 3, signal: ac.signal });
    expect(res).toBe("requeued");

    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, claimed.id));
    expect(row!.status).toBe("queued");
    expect(row!.attempts).toBe(0); // cofnięte do stanu sprzed claimNextJob — pełny budżet prób
    expect(row!.error).toBeNull();
    expect(row!.log).toMatch(/\[\d\d:\d\d:\d\d\] przerwano sygnałem; wrócił do kolejki/);
  });
});
