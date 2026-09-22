// Test integracyjny tras zadań: POST/GET /jobs, GET /jobs/:id,
// POST /jobs/:id/retry. Statusy i kształt params zgodne z realnym kontraktem `@dex-arb/shared`
// (job_status enum: queued|running|done|failed; params camelCase — poolId/windowId/pairId, jak
// w `jobParamsByType`, nie snake_case).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { JobDto, JobList } from "@dex-arb/shared";
import { buildApp } from "../src/app.js";
import { HAS_DB, testDb, type SeedIds, type TestDb } from "./helpers/db.js";

let t: TestDb;
let app: ReturnType<typeof buildApp>;
let ids: SeedIds;

describe.skipIf(!HAS_DB)("api: jobs (DATABASE_URL_TEST)", () => {
  beforeAll(async () => {
    t = await testDb();
    app = buildApp({ db: t.db });
    await t.reset();
    ids = await t.seedCatalog();
  });
  afterAll(async () => {
    await app.close();
    await t.close();
  });

  describe("zadania", () => {
    it("POST /jobs tworzy zadanie queued (job id=1)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/jobs",
        payload: { type: "ingest:pool-window", params: { poolId: ids.poolA, windowId: ids.windowId } },
      });
      expect(res.statusCode).toBe(201);
      const job = JobDto.parse(res.json());
      expect(job).toMatchObject({
        id: 1,
        type: "ingest:pool-window",
        status: "queued",
        progress: 0,
        attempts: 0,
        error: null,
      });
    });

    it("POST /jobs identyczne (ten sam type+params) queued → 409 ze wskazaniem istniejącego", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/jobs",
        payload: { type: "ingest:pool-window", params: { poolId: ids.poolA, windowId: ids.windowId } },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().job.id).toBe(1);
    });

    it("POST /jobs zła walidacja (analyze:pair-window bez pairId/windowId) → 400", async () => {
      const res = await app.inject({ method: "POST", url: "/jobs", payload: { type: "analyze:pair-window", params: {} } });
      expect(res.statusCode).toBe(400);
    });

    it("POST /jobs nieistniejąca pula → 404", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/jobs",
        payload: { type: "ingest:pool-window", params: { poolId: 999999, windowId: ids.windowId } },
      });
      expect(res.statusCode).toBe(404);
    });

    it("POST /jobs nieistniejące okno → 404", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/jobs",
        payload: { type: "analyze:pair-window", params: { pairId: ids.pairId, windowId: 999999 } },
      });
      expect(res.statusCode).toBe(404);
    });

    it("POST /jobs nieistniejąca para → 404", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/jobs",
        payload: { type: "analyze:pair-window", params: { pairId: 999999, windowId: ids.windowId } },
      });
      expect(res.statusCode).toBe(404);
    });

    it("GET /jobs zwraca listę, najnowsze pierwsze (job id=2)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/jobs",
        payload: { type: "analyze:pair-window", params: { pairId: ids.pairId, windowId: ids.windowId } },
      });
      expect(create.statusCode).toBe(201);

      const res = await app.inject({ method: "GET", url: "/jobs" });
      expect(res.statusCode).toBe(200);
      const jobs = JobList.parse(res.json());
      expect(jobs.map((j) => j.type)).toEqual(["analyze:pair-window", "ingest:pool-window"]);
    });

    it("GET /jobs?type= filtruje po typie", async () => {
      const res = await app.inject({ method: "GET", url: "/jobs?type=ingest:pool-window" });
      const jobs = JobList.parse(res.json());
      expect(jobs.map((j) => j.type)).toEqual(["ingest:pool-window"]);
    });

    it("GET /jobs?status= filtruje po statusie", async () => {
      const res = await app.inject({ method: "GET", url: "/jobs?status=queued" });
      const jobs = JobList.parse(res.json());
      expect(jobs).toHaveLength(2);
    });

    it("GET /jobs?limit= ogranicza liczbę wyników", async () => {
      const res = await app.inject({ method: "GET", url: "/jobs?limit=1" });
      const jobs = JobList.parse(res.json());
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.id).toBe(2);
    });

    it("GET /jobs/:id → 200 dla istniejącego / 404 dla brakującego", async () => {
      expect((await app.inject({ method: "GET", url: "/jobs/1" })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/jobs/999" })).statusCode).toBe(404);
    });

    it("POST /jobs/:id/retry — 409, gdy zadanie nie jest failed", async () => {
      const res = await app.inject({ method: "POST", url: "/jobs/1/retry" });
      expect(res.statusCode).toBe(409);
    });

    it("POST /jobs/:id/retry — 404 dla nieistniejącego zadania", async () => {
      expect((await app.inject({ method: "POST", url: "/jobs/999/retry" })).statusCode).toBe(404);
    });

    it("po done nowe identyczne zadanie jest dozwolone (job id=3)", async () => {
      await t.db.execute(sql`UPDATE jobs SET status = 'done', finished_at = now() WHERE id = 1`);
      const res = await app.inject({
        method: "POST",
        url: "/jobs",
        payload: { type: "ingest:pool-window", params: { poolId: ids.poolA, windowId: ids.windowId } },
      });
      expect(res.statusCode).toBe(201);
      expect(JobDto.parse(res.json()).id).toBe(3);
    });

    it("POST /jobs/:id/retry — po failed ustawia queued, attempts=0, error=null, finished_at=null, progress=0", async () => {
      await t.db.execute(sql`
        UPDATE jobs SET status = 'failed', attempts = 3, error = 'boom', progress = 57, finished_at = now(),
          log = 'próba 1: boom'
        WHERE id = 2
      `);
      const res = await app.inject({ method: "POST", url: "/jobs/2/retry" });
      expect(res.statusCode).toBe(200);
      const job = JobDto.parse(res.json());
      expect(job).toMatchObject({
        id: 2,
        status: "queued",
        attempts: 0,
        error: null,
        finished_at: null,
        progress: 0,
      });
      // log (historia dotychczasowych prób) nie jest czyszczony przez retry.
      expect(job.log).toBe("próba 1: boom");
    });

    // --- import:csv poolAliases i verify:pair-window pairId/windowId validation ---

    it("POST /jobs import:csv z nieistniejącym pool_id w poolAliases → 404 z listą brakujących id", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/jobs",
        payload: {
          type: "import:csv",
          params: { path: "x.csv", poolAliases: { uniswap: ids.poolA, sushiswap: 999999 } },
        },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain("999999");
    });

    it("POST /jobs import:csv z poprawnymi poolAliases → 201", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/jobs",
        payload: {
          type: "import:csv",
          params: { path: "x.csv", poolAliases: { uniswap: ids.poolA, sushiswap: ids.poolB } },
        },
      });
      expect(res.statusCode).toBe(201);
    });

    it("POST /jobs verify:pair-window z nieistniejącą parą → 404", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/jobs",
        payload: { type: "verify:pair-window", params: { pairId: 999999, windowId: ids.windowId } },
      });
      expect(res.statusCode).toBe(404);
    });

    it("POST /jobs verify:pair-window z nieistniejącym oknem → 404", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/jobs",
        payload: { type: "verify:pair-window", params: { pairId: ids.pairId, windowId: 999999 } },
      });
      expect(res.statusCode).toBe(404);
    });

    it("POST /jobs verify:pair-window z poprawnymi pairId/windowId → 201", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/jobs",
        payload: { type: "verify:pair-window", params: { pairId: ids.pairId, windowId: ids.windowId } },
      });
      expect(res.statusCode).toBe(201);
    });

    // Regresja: PairWindowRefs.parse(body.params) (gołe .parse(), nie parseOr400) przy złym
    // kształcie (pairId nie-numeryczny) rzucało surowy ZodError, który globalny errorHandler w
    // app.ts traktuje jako niezgodność kontraktu WYJŚCIA → 500, zamiast poprawnego 400 dla
    // walidacji WEJŚCIA.
    it("POST /jobs verify:pair-window z pairId typu string (zły kształt) → 400, nie 500", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/jobs",
        payload: { type: "verify:pair-window", params: { pairId: "x", windowId: ids.windowId } },
      });
      expect(res.statusCode).toBe(400);
    });

    it("POST /jobs z niepoprawnym JSON w body → 400 (błąd parsowania Fastify, nie 500)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/jobs",
        headers: { "content-type": "application/json" },
        payload: "{niepoprawny json",
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty("error");
    });

    // --- Parallel duplicate handling ---

    it("dwa równoległe POST /jobs z identycznym type+params → dokładnie jedno 201 i jedno 409 na tego samego duplikata", async () => {
      const payload = { type: "ingest:pool-window" as const, params: { poolId: ids.poolB, windowId: ids.windowId } };
      const [r1, r2] = await Promise.all([
        app.inject({ method: "POST", url: "/jobs", payload }),
        app.inject({ method: "POST", url: "/jobs", payload }),
      ]);
      const codes = [r1.statusCode, r2.statusCode].sort();
      expect(codes).toEqual([201, 409]);

      const created = r1.statusCode === 201 ? r1 : r2;
      const rejected = r1.statusCode === 409 ? r1 : r2;
      const createdJob = JobDto.parse(created.json());
      expect(rejected.json().job.id).toBe(createdJob.id);

      // Tylko jedno zadanie queued dla tej pary (poolB, windowId) — indeks unikalny częściowy
      // (migracja 0003) zablokował drugi INSERT na poziomie bazy, nie tylko SELECT-em w API.
      const rows = await t.db.execute(sql`
        SELECT count(*)::int AS n FROM jobs
        WHERE type = 'ingest:pool-window' AND params = ${JSON.stringify(payload.params)}::jsonb
          AND status IN ('queued', 'running')
      `);
      expect((rows[0] as { n: number }).n).toBe(1);
    });

    // Test deterministyczny (bez zależności od faktycznego wyścigu przez app.inject()) —
    // sprawdza wprost indeks unikalny częściowy z migracji 0003 i kształt błędu, jaki drizzle-orm
    // rzuca przy jego naruszeniu: `DrizzleQueryError` z SQLSTATE w `.cause.code` (NIE `.code` na
    // samym błędzie) — dokładnie to, co `isUniqueViolation` w routes/jobs.ts musi rozpoznać.
    it("indeks jobs_type_params_active_unique (migracja 0003) blokuje drugi INSERT identycznego (type,params) w queued/running na poziomie bazy", async () => {
      const params = { test: "duplicate-constraint" };
      await t.db.execute(sql`DELETE FROM jobs WHERE type = 'train' AND params = ${JSON.stringify(params)}::jsonb`);
      const insertOnce = () =>
        t.db.execute(sql`
          INSERT INTO jobs (type, params, status, progress)
          VALUES ('train', ${JSON.stringify(params)}::jsonb, 'queued', 0)
          RETURNING id
        `);
      await insertOnce();
      await expect(insertOnce()).rejects.toMatchObject({ cause: { code: "23505" } });
    });
  });
});
