// Test integracyjny GET /coverage: pokrycie ingestu
// (ingest_ranges, per pula, przycięte do okna, liczone jako UNIA przedziałów — nie prosta suma
// długości, żeby nakładające się zakresy tego samego statusu nie liczyły wspólnych bloków
// więcej niż raz) + pokrycie analizy (block_states, model_scores, per para×okno).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { CoverageResponse, CoverageCellDto } from "@dex-arb/shared";
import { loadCoverage } from "@dex-arb/db";
import { buildApp } from "../src/app.js";
import { HAS_DB, testDb, type SeedIds, type TestDb } from "./helpers/db.js";

let t: TestDb;
let app: ReturnType<typeof buildApp>;
let ids: SeedIds;
let nullWindowId: number;
let overlapWindowId: number;

describe.skipIf(!HAS_DB)("api: coverage (DATABASE_URL_TEST)", () => {
  beforeAll(async () => {
    t = await testDb();
    app = buildApp({ db: t.db });
    await t.reset();
    ids = await t.seedCatalog();

    // Pula A (Uniswap): 600/1000 bloków okna done, 100 failed, 300 pending. Pula B (Sushiswap): nic.
    await t.db.execute(sql`INSERT INTO ingest_ranges (pool_id, from_block, to_block, status) VALUES
      (${ids.poolA},1000,1499,'done'), (${ids.poolA},1500,1599,'done'),
      (${ids.poolA},1600,1699,'failed'), (${ids.poolA},1700,1999,'pending')`);

    // 3 wiersze block_states (bloki 1000-1002) + 1 model z wynikiem na bloku 1000.
    await t.db.execute(sql`INSERT INTO block_states (pair_id, window_id, block, price_a, price_b, spread_pct,
        tvl_min_usd, gas_price_median, swaps_in_block, s, g, l, m, opt_trade_usd, baseline_net_profit_usd, baseline_feasible)
      VALUES (${ids.pairId},${ids.windowId},1000,4000,4010,0.25,50e6,100,2,0.25,0.1,50,10,1000,-5,false),
             (${ids.pairId},${ids.windowId},1001,4000,4020,0.5,50e6,110,3,0.5,0.1,50,10,1000,-3,false),
             (${ids.pairId},${ids.windowId},1002,4000,4030,0.75,50e6,120,1,0.75,0.1,50,10,1000,2,true)`);
    await t.db.execute(sql`INSERT INTO model_scores (model_id, pair_id, block, score, label)
      VALUES (${ids.modelId},${ids.pairId},1000,10,'niewykonalna')`);

    // Drugie okno bez wyznaczonych bloków (from_block/to_block NULL) — brak jakiegokolwiek ingestu/analizy.
    const [nullWindow] = await t.db.execute<{ id: number }>(
      sql`INSERT INTO windows (name, from_ts, to_ts, from_block, to_block)
          VALUES ('okno-bez-blokow', '2021-06-01T00:00:00Z', '2021-06-01T01:00:00Z', NULL, NULL)
          RETURNING id`,
    );
    nullWindowId = nullWindow!.id;

    // Trzecie okno (100 bloków: 5000-5099) na test nakładających się zakresów ingest_ranges.
    const [overlapWindow] = await t.db.execute<{ id: number }>(
      sql`INSERT INTO windows (name, from_ts, to_ts, from_block, to_block)
          VALUES ('okno-nakladajace', '2021-06-02T00:00:00Z', '2021-06-02T01:00:00Z', 5000, 5099)
          RETURNING id`,
    );
    overlapWindowId = overlapWindow!.id;
    // Pula A: dwa NAKŁADAJĄCE SIĘ zakresy 'done' pokrywające razem cały region (5000-5069 +
    // 5030-5099, wspólna część 5030-5069 = 40 bloków) — unia to dokładnie 100 bloków (cały region),
    // suma długości przyciętych zakresów to błędne 140.
    await t.db.execute(sql`INSERT INTO ingest_ranges (pool_id, from_block, to_block, status) VALUES
      (${ids.poolA},5000,5069,'done'), (${ids.poolA},5030,5099,'done')`);
    // Pula B: zakres 'done' (5000-5049, 50 bloków) nakładający się z zakresem 'pending'
    // (5030-5099, 70 bloków) na wspólnej części 5030-5049 (20 bloków) — done liczy się raz (50),
    // niezależnie od nakładania z innym statusem.
    await t.db.execute(sql`INSERT INTO ingest_ranges (pool_id, from_block, to_block, status) VALUES
      (${ids.poolB},5000,5049,'done'), (${ids.poolB},5030,5099,'pending')`);
  });

  afterAll(async () => {
    await app.close();
    await t.close();
  });

  describe("GET /coverage", () => {
    it("liczy bloki done/failed/pending per pula i pokrycie analizy per para×okno", async () => {
      const res = await app.inject({ method: "GET", url: "/coverage" });
      expect(res.statusCode).toBe(200);
      const cells = CoverageResponse.parse(res.json());

      const cell = cells.find((c) => c.window_id === ids.windowId)!;
      expect(cell).toMatchObject({
        pair_id: ids.pairId,
        window_id: ids.windowId,
        window_has_blocks: true,
        block_states: 3,
        states_min_block: 1000,
        states_max_block: 1002,
        scored_models: 1,
      });

      const poolA = cell.pools.find((p) => p.pool_id === ids.poolA)!;
      expect(poolA).toMatchObject({ done_blocks: 600, failed_blocks: 100, pending_blocks: 300, total_blocks: 1000 });
      expect(poolA.coverage_pct).toBeCloseTo(60, 5);

      const poolB = cell.pools.find((p) => p.pool_id === ids.poolB)!;
      expect(poolB).toMatchObject({ done_blocks: 0, coverage_pct: 0, total_blocks: 1000 });
    });

    it("okno bez wyznaczonych bloków (from_block/to_block NULL) → coverage_pct null z flagą window_has_blocks=false", async () => {
      const res = await app.inject({ method: "GET", url: "/coverage" });
      const cells = CoverageResponse.parse(res.json());
      const nullWindowCell = cells.find((c) => c.window_id === nullWindowId)!;
      expect(nullWindowCell).toMatchObject({
        window_has_blocks: false,
        block_states: 0,
        states_min_block: null,
        states_max_block: null,
        scored_models: 0,
      });
      for (const pool of nullWindowCell.pools) {
        expect(pool.coverage_pct).toBeNull();
        expect(pool.total_blocks).toBe(0);
      }
    });

    it("dwa nakładające się zakresy 'done' → pokrycie dokładnie 100%, nigdy więcej", async () => {
      const res = await app.inject({ method: "GET", url: "/coverage" });
      const cells = CoverageResponse.parse(res.json());
      const cell = cells.find((c) => c.window_id === overlapWindowId)!;
      const poolA = cell.pools.find((p) => p.pool_id === ids.poolA)!;
      expect(poolA.total_blocks).toBe(100);
      expect(poolA.done_blocks).toBe(100);
      expect(poolA.coverage_pct).toBe(100);
    });

    it("nakładanie się 'done' z 'pending' → 'done' liczy się raz, niezależnie od innego statusu", async () => {
      const res = await app.inject({ method: "GET", url: "/coverage" });
      const cells = CoverageResponse.parse(res.json());
      const cell = cells.find((c) => c.window_id === overlapWindowId)!;
      const poolB = cell.pools.find((p) => p.pool_id === ids.poolB)!;
      expect(poolB).toMatchObject({ done_blocks: 50, pending_blocks: 70, total_blocks: 100 });
      expect(poolB.coverage_pct).toBe(50);
    });

    it("loadCoverage z @dex-arb/db respektuje kontrakt CoverageCellDto z @dex-arb/shared", async () => {
      for (const cell of await loadCoverage(t.db)) CoverageCellDto.parse(cell);
    });
  });
});
