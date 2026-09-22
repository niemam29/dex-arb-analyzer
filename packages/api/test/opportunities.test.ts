// Test integracyjny GET /pairs/:id/windows/:wid/opportunities i GET /opportunities/:id:
// paginacja, filtry (status/min_spread/model), 400 dla złego statusu, 404 dla
// nieznanej pary/okna/okazji, szczegóły z rezerwami obu pul (ostatni Sync <= blok), cechami
// block_states, aktywacjami reguł Mamdaniego liczonymi on-the-fly i linkiem do Etherscan.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { DEFAULT_MAMDANI_PARAMS } from "@dex-arb/core";
import { OpportunityDetail, OpportunityList } from "@dex-arb/shared";
import { buildApp } from "../src/app.js";
import { HAS_DB, testDb, type SeedIds, type TestDb } from "./helpers/db.js";

let t: TestDb;
let app: ReturnType<typeof buildApp>;
let ids: SeedIds;
let mamdaniModelId: number;
let opp100Id: number;
let opp200Id: number;

describe.skipIf(!HAS_DB)("api: opportunities (DATABASE_URL_TEST)", () => {
  beforeAll(async () => {
    t = await testDb();
    app = buildApp({ db: t.db });
    await t.reset();
    ids = await t.seedCatalog();

    const [m] = await t.db.execute<{ id: number }>(
      sql`INSERT INTO scoring_models (name, kind, version, params) VALUES
          ('mamdani', 'mamdani', 1, ${JSON.stringify(DEFAULT_MAMDANI_PARAMS)}::jsonb) RETURNING id`,
    );
    mamdaniModelId = m!.id;

    // Blok 100: spread duży (1.0%), cechy S/G/L/M dobrane tak, by reguła R6 (S=umiarkowana,
    // G=niski, M=srednie) się odpaliła (strength = min(0.8, 0.5, 0.5) = 0.5 > 0), patrz
    // packages/core/src/mamdani.params.ts DEFAULT_MAMDANI_PARAMS. Blok 200: spread poniżej progu.
    await t.db.execute(sql`INSERT INTO block_states (pair_id, window_id, block, price_a, price_b, spread_pct,
        tvl_min_usd, gas_price_median, swaps_in_block, s, g, l, m, opt_trade_usd, baseline_net_profit_usd, baseline_feasible)
      VALUES (${ids.pairId},${ids.windowId},100,3000,3030,1.0,50e6,100e9,3,1.0,0.2,50,40,20000,15,true),
             (${ids.pairId},${ids.windowId},200,3000,3021,0.7,50e6,100e9,1,0.7,0.2,50,20,8000,-5,false)`);

    await t.db.execute(sql`INSERT INTO sync_events (pool_id, block, log_index, tx_hash, reserve0, reserve1) VALUES
      (${ids.poolA},99,1,'0x1','150000000000000','50000000000000000000000'),
      (${ids.poolB},98,1,'0x2','30300000000000','10000000000000000000000')`);

    const [o1, o2] = await t.db.execute<{ id: number }>(sql`INSERT INTO opportunities
        (pair_id, window_id, block, spread_pct, direction, est_profit_usd) VALUES
        (${ids.pairId},${ids.windowId},100,1.0,'a_to_b',15), (${ids.pairId},${ids.windowId},200,0.7,'a_to_b',-5)
      RETURNING id`);
    opp100Id = o1!.id;
    opp200Id = o2!.id;

    await t.db.execute(sql`INSERT INTO opportunity_verifications
        (opportunity_id, status, route, consumer_tx_hash, realized_profit_usd, gas_used, gas_cost_usd,
         blocks_to_consumption, profitable_consumed, verified_at)
      VALUES (${opp100Id}, 'consumed_atomic', 'two_pool', '0xabababababababababababababababababababababababababababababababab', 20, 200000, 60, 1, false, '2021-05-14T00:01:00Z')`);

    await t.db.execute(sql`INSERT INTO model_scores (model_id, pair_id, block, score, label)
      VALUES (${mamdaniModelId}, ${ids.pairId}, 100, 42.1, 'wykonalna')`);
  });

  afterAll(async () => {
    await app.close();
    await t.close();
  });

  describe("GET /pairs/:id/windows/:wid/opportunities", () => {
    it("paginuje (page_size=1) i sortuje po block rosnąco", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/pairs/${ids.pairId}/windows/${ids.windowId}/opportunities?page_size=1`,
      });
      expect(res.statusCode).toBe(200);
      const body = OpportunityList.parse(res.json());
      expect(body.total).toBe(2);
      expect(body.page).toBe(1);
      expect(body.page_size).toBe(1);
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        id: opp100Id,
        block: 100,
        spread_pct: 1.0,
        verification: { status: "consumed_atomic", route: "two_pool", consumer_tx_hash: "0xabababababababababababababababababababababababababababababababab", realized_profit_usd: 20 },
      });
    });

    it("druga strona (page=2, page_size=1) zwraca drugi element", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/pairs/${ids.pairId}/windows/${ids.windowId}/opportunities?page_size=1&page=2`,
      });
      const body = OpportunityList.parse(res.json());
      expect(body.items).toHaveLength(1);
      expect(body.items[0]!.block).toBe(200);
      expect(body.items[0]!.verification).toBeNull();
    });

    it("status=unverified zwraca tylko okazje bez weryfikacji", async () => {
      const res = await app.inject({
        url: `/pairs/${ids.pairId}/windows/${ids.windowId}/opportunities?status=unverified`,
      });
      const body = OpportunityList.parse(res.json());
      expect(body.items.map((i) => i.block)).toEqual([200]);
    });

    it("status=consumed_atomic zwraca tylko zweryfikowane tym statusem", async () => {
      const res = await app.inject({
        url: `/pairs/${ids.pairId}/windows/${ids.windowId}/opportunities?status=consumed_atomic`,
      });
      const body = OpportunityList.parse(res.json());
      expect(body.items.map((i) => i.block)).toEqual([100]);
    });

    it("min_spread filtruje po spread_pct", async () => {
      const res = await app.inject({
        url: `/pairs/${ids.pairId}/windows/${ids.windowId}/opportunities?min_spread=0.9`,
      });
      const body = OpportunityList.parse(res.json());
      expect(body.items.map((i) => i.block)).toEqual([100]);
    });

    it("model=mamdani dołącza score/label do mapy scores (null, gdy brak wyniku dla bloku)", async () => {
      const res = await app.inject({
        url: `/pairs/${ids.pairId}/windows/${ids.windowId}/opportunities?model=mamdani`,
      });
      const body = OpportunityList.parse(res.json());
      const item100 = body.items.find((i) => i.block === 100)!;
      const item200 = body.items.find((i) => i.block === 200)!;
      expect(item100.scores).toEqual({ mamdani: { score: 42.1, label: "wykonalna" } });
      expect(item200.scores).toEqual({ mamdani: null });
    });

    it("bez model= zwraca pustą mapę scores", async () => {
      const res = await app.inject({ url: `/pairs/${ids.pairId}/windows/${ids.windowId}/opportunities` });
      const body = OpportunityList.parse(res.json());
      expect(body.items.every((i) => Object.keys(i.scores).length === 0)).toBe(true);
    });

    it("odrzuca nieznany status → 400", async () => {
      const res = await app.inject({
        url: `/pairs/${ids.pairId}/windows/${ids.windowId}/opportunities?status=bogus`,
      });
      expect(res.statusCode).toBe(400);
    });

    it("odrzuca page_size > 500 → 400", async () => {
      const res = await app.inject({
        url: `/pairs/${ids.pairId}/windows/${ids.windowId}/opportunities?page_size=501`,
      });
      expect(res.statusCode).toBe(400);
    });

    it("nieznana para → 404", async () => {
      const res = await app.inject({ url: `/pairs/999999/windows/${ids.windowId}/opportunities` });
      expect(res.statusCode).toBe(404);
    });

    it("nieznane okno → 404", async () => {
      const res = await app.inject({ url: `/pairs/${ids.pairId}/windows/999999/opportunities` });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /opportunities/:id", () => {
    it("zwraca rezerwy obu pul, cechy S/G/L/M, aktywacje reguł, weryfikację i link do Etherscan", async () => {
      const res = await app.inject({ url: `/opportunities/${opp100Id}` });
      expect(res.statusCode).toBe(200);
      const d = OpportunityDetail.parse(res.json());

      expect(d).toMatchObject({
        id: opp100Id,
        pair_id: ids.pairId,
        window_id: ids.windowId,
        block: 100,
        s: 1.0,
        g: 0.2,
        l: 50,
        m: 40,
        opt_trade_usd: 20000,
        baseline_net_profit_usd: 15,
        baseline_feasible: true,
        etherscan_url: "https://etherscan.io/tx/0xabababababababababababababababababababababababababababababababab",
      });
      expect(d.verification?.status).toBe("consumed_atomic");
      expect(d.verification?.route).toBe("two_pool");

      expect(d.reserves).toHaveLength(2);
      const poolAReserve = d.reserves.find((r) => r.pool_id === ids.poolA)!;
      expect(poolAReserve).toMatchObject({ block: 99, reserve0: "150000000000000", reserve1: "50000000000000000000000" });
      const poolBReserve = d.reserves.find((r) => r.pool_id === ids.poolB)!;
      expect(poolBReserve).toMatchObject({ block: 98, reserve0: "30300000000000", reserve1: "10000000000000000000000" });

      expect(d.rule_activations).toHaveLength(16);
      expect(d.rule_activations.map((a) => a.id).sort()).toEqual(
        Array.from({ length: 16 }, (_, i) => `R${i + 1}`).sort(),
      );
      expect(d.rule_activations.some((a) => a.strength > 0)).toBe(true);
      const r6 = d.rule_activations.find((a) => a.id === "R6")!;
      expect(r6.strength).toBeCloseTo(0.5, 9);
    });

    it("okazja bez weryfikacji → verification null i etherscan_url null", async () => {
      const res = await app.inject({ url: `/opportunities/${opp200Id}` });
      const d = OpportunityDetail.parse(res.json());
      expect(d.verification).toBeNull();
      expect(d.etherscan_url).toBeNull();
      expect(d.reserves).toHaveLength(2);
    });

    it("weryfikacja z route='multi' (zysk nieznany) → verification.route = 'multi', realized_profit_usd null", async () => {
      // Tymczasowa okazja w bloku 300 (własny block_states, bo detail wymaga wiersza stanu);
      // sprzątana na końcu, żeby nie zmieniać `total` w testach listy.
      await t.db.execute(sql`INSERT INTO block_states (pair_id, window_id, block, price_a, price_b, spread_pct,
          tvl_min_usd, gas_price_median, swaps_in_block, s, g, l, m, opt_trade_usd, baseline_net_profit_usd, baseline_feasible)
        VALUES (${ids.pairId},${ids.windowId},300,3000,3030,1.0,50e6,100e9,3,1.0,0.2,50,40,20000,15,true)`);
      const [o] = await t.db.execute<{ id: number }>(sql`INSERT INTO opportunities
          (pair_id, window_id, block, spread_pct, direction, est_profit_usd)
        VALUES (${ids.pairId},${ids.windowId},300,1.0,'a_to_b',15) RETURNING id`);
      try {
        await t.db.execute(sql`INSERT INTO opportunity_verifications
            (opportunity_id, status, route, consumer_tx_hash, realized_profit_usd, gas_used, gas_cost_usd,
             blocks_to_consumption, profitable_consumed, verified_at)
          VALUES (${o!.id}, 'consumed_atomic', 'multi', '0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd', NULL, 350000, 90, 1, false, '2021-05-14T00:02:00Z')`);

        const res = await app.inject({ url: `/opportunities/${o!.id}` });
        expect(res.statusCode).toBe(200);
        const d = OpportunityDetail.parse(res.json());
        expect(d.verification).toMatchObject({ status: "consumed_atomic", route: "multi", realized_profit_usd: null, profitable_consumed: false });
      } finally {
        await t.db.execute(sql`DELETE FROM opportunities WHERE id = ${o!.id}`);
        await t.db.execute(sql`DELETE FROM block_states WHERE pair_id = ${ids.pairId} AND block = 300`);
      }
    });

    it("CHECK: route ≠ NULL przy statusie innym niż consumed_atomic oraz route='multi' ∧ profitable_consumed → odrzucone", async () => {
      // drizzle opakowuje błąd postgres.js ("Failed query: ...") — nazwa naruszonego CHECK-a
      // siedzi w `cause.constraint_name`.
      const constraintOf = async (p: Promise<unknown>): Promise<string | undefined> => {
        try {
          await p;
          return undefined;
        } catch (e) {
          return (e as { cause?: { constraint_name?: string } }).cause?.constraint_name;
        }
      };
      expect(
        await constraintOf(
          t.db.execute(sql`INSERT INTO opportunity_verifications (opportunity_id, status, route, profitable_consumed)
            VALUES (${opp200Id}, 'decayed', 'two_pool', false)`),
        ),
      ).toBe("opportunity_verifications_route_status_check");
      expect(
        await constraintOf(
          t.db.execute(sql`INSERT INTO opportunity_verifications (opportunity_id, status, route, consumer_tx_hash, profitable_consumed)
            VALUES (${opp200Id}, 'consumed_atomic', 'multi', '0xefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef', true)`),
        ),
      ).toBe("opportunity_verifications_route_multi_unprofitable_check");
    });

    it("nieznane id → 404", async () => {
      const res = await app.inject({ url: "/opportunities/999999" });
      expect(res.statusCode).toBe(404);
    });
  });
});
