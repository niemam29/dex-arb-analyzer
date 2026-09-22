// Ładowanie katalogu par i najnowszych parametrów modeli dla pollera (spec §4): pomijane bez
// DATABASE_URL_TEST (wzorzec HAS_DB jak w pozostałych testach integracyjnych analysis).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { initFromMamdani } from "@dex-arb/core";
import { loadLiveModels, loadLivePairs } from "../../src/live/load.js";
import { HAS_DB, resetDb, type Seeded } from "../helpers/db.js";

const bv2Old = { gasUnits: 220000, arbGasRef: 220000, gasPriceFactor: 1, threshold: 0.5, weightOptTrade: 0, scale: 10, optTradeQuantiles: [0, 1] };
const bv2New = { gasUnits: 150000, arbGasRef: 220000, gasPriceFactor: 0.5, threshold: 0.42, weightOptTrade: 0, scale: 12.5, optTradeQuantiles: [0, 1, 2] };

describe.skipIf(!HAS_DB)("live/load", () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let seeded: Seeded;

  beforeAll(async () => {
    const conn = createTestDb();
    db = conn.db;
    closeDb = () => conn.sql.end();
    seeded = await resetDb(db);
  });
  afterAll(async () => {
    await closeDb();
  });

  it("loadLivePairs: para z katalogu z pulą A = uniswap-v2, B = sushiswap, dekimalami i symbolami tokenów", async () => {
    const pairs = await loadLivePairs(db);
    expect(pairs).toHaveLength(1);
    const p = pairs[0]!;
    expect(p).toMatchObject({
      id: seeded.pairId,
      symbol: "WETH/USDC",
      tokenBase: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      tokenQuote: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      decBase: 18,
      decQuote: 6,
      baseSymbol: "WETH",
      quoteSymbol: "USDC",
    });
    expect(p.poolA).toEqual({ address: "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc", token0: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", token1: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", dexName: "uniswap-v2", feeBps: 30 });
    expect(p.poolB.address).toBe("0x397ff1542f962076d0bfe58ea045ffa2d347aca0");
    expect(p.poolB.dexName).toBe("sushiswap");
  });

  it("loadLivePairs: para bez puli Sushiswap jest pomijana z logiem", async () => {
    const log: string[] = [];
    await db.insert(schema.tokens).values({ address: "0xdac17f958d2ee523a2206206994597c13d831ec7", symbol: "USDT", decimals: 6 });
    const [usdt] = await db.insert(schema.pairs).values({ symbol: "WETH/USDT", tokenBase: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", tokenQuote: "0xdac17f958d2ee523a2206206994597c13d831ec7" }).returning();
    const [uni] = await db.select().from(schema.dexes).where(sql`name = 'uniswap-v2'`);
    await db.insert(schema.pools).values({ dexId: uni!.id, pairId: usdt!.id, address: "0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852", token0: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", token1: "0xdac17f958d2ee523a2206206994597c13d831ec7" });
    const pairs = await loadLivePairs(db, (m) => log.push(m));
    expect(pairs.map((p) => p.symbol)).toEqual(["WETH/USDC"]);
    expect(log.join("\n")).toContain("WETH/USDT");
  });

  it("loadLiveModels: bez wierszy -> baselineV2/anfis null; z wierszami -> NAJNOWSZY (max id) per kind", async () => {
    const empty = await loadLiveModels(db);
    expect(empty.baselineV2).toBeNull();
    expect(empty.anfis).toBeNull();
    expect(empty.baseline.kind).toBe("baseline");

    await db.insert(schema.scoringModels).values([
      { name: "baseline_v2", kind: "baseline_v2", version: 1, params: bv2Old },
      { name: "baseline_v2", kind: "baseline_v2", version: 2, params: bv2New },
      { name: "anfis", kind: "anfis", version: 1, params: initFromMamdani() },
    ]);
    const m = await loadLiveModels(db);
    expect(m.baselineV2!.params.gasUnits).toBe(150000);
    expect(m.baselineV2!.params.threshold).toBe(0.42);
    expect(m.anfis!.params.rules).toHaveLength(16);
  });

  it("loadLiveModels: uszkodzone params -> null + log, nie wyjątek", async () => {
    const log: string[] = [];
    await db.insert(schema.scoringModels).values({ name: "anfis", kind: "anfis", version: 2, params: { version: 1, broken: true } });
    const m = await loadLiveModels(db, (msg) => log.push(msg));
    expect(m.anfis).toBeNull();
    expect(m.baselineV2).not.toBeNull();
    expect(log.some((l) => l.includes("anfis"))).toBe(true);
  });
});
