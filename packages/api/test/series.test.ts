// Test integracyjny GET /pairs/:id/windows/:wid/series: szereg czasowy
// zagregowany w SQL po N bloków (kubełki) — matematyka kubełkowania, ostatnia cena w kubełku,
// mediana gazu, mapa avg score per model, domyślny step, zawężanie zakresu from/to, walidacja
// i 404. Wzorowane na test/coverage.test.ts i test/jobs.test.ts (ids = await t.seedCatalog()).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { SeriesResponse } from "@dex-arb/shared";
import { buildApp } from "../src/app.js";
import { autoStep } from "../src/queries/series.sql.js";
import { HAS_DB, testDb, type SeedIds, type TestDb } from "./helpers/db.js";

let t: TestDb;
let app: ReturnType<typeof buildApp>;
let ids: SeedIds;
let modelId2: number;
let modelId3: number;
let emptyWindowId: number;

describe.skipIf(!HAS_DB)("api: series (DATABASE_URL_TEST)", () => {
  beforeAll(async () => {
    t = await testDb();
    app = buildApp({ db: t.db });
    await t.reset();
    ids = await t.seedCatalog();

    const [m2] = (await t.db.execute(
      sql`INSERT INTO scoring_models (name, kind, version, params) VALUES ('mamdani','mamdani',1,'{}'::jsonb) RETURNING id`,
    )) as unknown as { id: number }[];
    modelId2 = m2!.id;
    // modelId3 nigdy nie dostaje wyniku (model_scores) w seedowanym oknie — celowo, żeby sprawdzić,
    // że GET .../series nie wymienia go w `models` (brak samych `null` w serii).
    const [m3] = (await t.db.execute(
      sql`INSERT INTO scoring_models (name, kind, version, params) VALUES ('anfis','anfis',1,'{}'::jsonb) RETURNING id`,
    )) as unknown as { id: number }[];
    modelId3 = m3!.id;

    // 10 bloków 1000..1009 (mieszczą się w oknie z seedCatalog: from_block=1000, to_block=1999):
    // spread rośnie 0,1..1,0; gas = 100+i*10; price_b = 4000+i; score modelu 1 = i*10, modelu 2 = 50 (stałe).
    for (let i = 0; i < 10; i++) {
      const block = 1000 + i;
      await t.db.execute(sql`INSERT INTO block_states (pair_id, window_id, block, price_a, price_b, spread_pct,
          tvl_min_usd, gas_price_median, swaps_in_block, s, g, l, m, opt_trade_usd, baseline_net_profit_usd, baseline_feasible)
        VALUES (${ids.pairId},${ids.windowId},${block},4000,${4000 + i},${(i + 1) / 10},50e6,${100 + i * 10},1,0,0,0,0,0,0,false)`);
      await t.db.execute(sql`INSERT INTO model_scores (model_id, pair_id, block, score, label) VALUES
        (${ids.modelId},${ids.pairId},${block},${i * 10},'niewykonalna'), (${modelId2},${ids.pairId},${block},50,'niewykonalna')`);
    }
    // timestamp tylko dla bloku 1004 i 1009 (blocks = tylko bloki z eventami)
    await t.db.execute(sql`INSERT INTO blocks (number, timestamp, gas_price_median, tx_count) VALUES
      (1004,'2021-05-14T00:10:00Z',100,1), (1009,'2021-05-14T00:20:00Z',100,1)`);

    const [win2] = (await t.db.execute(sql`INSERT INTO windows (name, from_ts, to_ts, from_block, to_block)
      VALUES ('puste','2021-05-15T00:00:00Z','2021-05-15T01:00:00Z',5000,5999) RETURNING id`)) as unknown as {
      id: number;
    }[];
    emptyWindowId = win2!.id;
  });
  afterAll(async () => {
    await app.close();
    await t.close();
  });

  describe("autoStep", () => {
    it("daje 1 dla małych zakresów i ceil(n/2000) dla dużych", () => {
      expect(autoStep(10)).toBe(1);
      expect(autoStep(2000)).toBe(1);
      expect(autoStep(77_388)).toBe(39);
    });
  });

  describe("GET /pairs/:id/windows/:wid/series", () => {
    it("step=5 → 2 kubełki z avg/min/max spreadu, ostatnią ceną, medianą gazu, avg score per model", async () => {
      const res = await app.inject({ method: "GET", url: `/pairs/${ids.pairId}/windows/${ids.windowId}/series?step=5` });
      expect(res.statusCode).toBe(200);
      const s = SeriesResponse.parse(res.json());
      expect(s).toMatchObject({
        pair_id: ids.pairId,
        window_id: ids.windowId,
        step: 5,
        from_block: 1000,
        to_block: 1999,
        threshold_pct: 0.65,
      });
      // modelId3 nie ma żadnego wyniku dla (pairId, [1000,1999]) — nie jest w `models`.
      expect(s.models.map((m) => m.id)).toEqual([ids.modelId, modelId2]);
      expect(s.models.map((m) => m.id)).not.toContain(modelId3);
      expect(s.points).toHaveLength(2);
      const [b0, b1] = s.points;
      expect(b0).toMatchObject({ from_block: 1000, to_block: 1004, price_a: 4000, price_b: 4004, spread_min: 0.1, spread_max: 0.5 });
      expect(b0!.spread_avg).toBeCloseTo(0.3, 9);
      expect(b0!.gas_median).toBe(120);
      expect(b0!.ts).toBe("2021-05-14T00:10:00.000Z");
      expect(b0!.scores).toEqual({ [String(ids.modelId)]: 20, [String(modelId2)]: 50 });
      expect(b1).toMatchObject({ from_block: 1005, to_block: 1009, price_b: 4009, spread_max: 1.0 });
      expect(b1!.scores[String(ids.modelId)]).toBe(70);
    });

    it("from/to zawęża zakres; step domyślny = 1 dla małego zakresu", async () => {
      const res = await app.inject({ method: "GET", url: `/pairs/${ids.pairId}/windows/${ids.windowId}/series?from=1002&to=1003` });
      const s = SeriesResponse.parse(res.json());
      expect(s.step).toBe(1);
      expect(s.points.map((p) => p.from_block)).toEqual([1002, 1003]);
      expect(s.points[0]!.ts).toBeNull();
    });

    it("from poniżej granicy okna jest przycinane do początku okna (schemat SeriesQuery wymaga " +
      "from nonnegative, więc zamiast ujemnej wartości używamy from=0 < from_block=1000)", async () => {
      const res = await app.inject({ method: "GET", url: `/pairs/${ids.pairId}/windows/${ids.windowId}/series?from=0` });
      expect(res.statusCode).toBe(200);
      const s = SeriesResponse.parse(res.json());
      expect(s.from_block).toBe(1000);
      expect(s.to_block).toBe(1999);
    });

    it("from poza końcem okna (zakres nie przecina się z oknem po przycięciu) → 400", async () => {
      const res = await app.inject({ method: "GET", url: `/pairs/${ids.pairId}/windows/${ids.windowId}/series?from=99999999` });
      expect(res.statusCode).toBe(400);
    });

    it("to przed początkiem okna (zakres nie przecina się z oknem po przycięciu) → 400", async () => {
      const res = await app.inject({ method: "GET", url: `/pairs/${ids.pairId}/windows/${ids.windowId}/series?to=1` });
      expect(res.statusCode).toBe(400);
    });

    it("zły step → 400; nieistniejące okno → 404", async () => {
      expect((await app.inject({ method: "GET", url: `/pairs/${ids.pairId}/windows/${ids.windowId}/series?step=0` })).statusCode).toBe(
        400,
      );
      expect((await app.inject({ method: "GET", url: `/pairs/${ids.pairId}/windows/999999/series` })).statusCode).toBe(404);
    });

    it("okno bez block_states → pusta lista punktów i pusta lista modeli (żadnych wyników w zakresie)", async () => {
      const s = SeriesResponse.parse(
        (await app.inject({ method: "GET", url: `/pairs/${ids.pairId}/windows/${emptyWindowId}/series` })).json(),
      );
      expect(s.points).toEqual([]);
      expect(s.models).toEqual([]);
    });
  });
});
