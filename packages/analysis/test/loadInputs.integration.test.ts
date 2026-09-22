// Test integracyjny `loadPairWindowInputs` na realnej bazie testowej.
// Uruchomienie: DATABASE_URL_TEST=postgres://dexarb:dexarb@localhost:5433/dexarb_test npx vitest run packages/analysis
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { eq } from "drizzle-orm";
import { loadPairWindowInputs } from "../src/loadInputs.js";
import { HAS_DB, resetDb, type Seeded } from "./helpers/db.js";

describe.skipIf(!HAS_DB)("loadPairWindowInputs", () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let seeded: Seeded;

  beforeAll(() => {
    const conn = createTestDb();
    db = conn.db;
    closeDb = () => conn.sql.end();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    seeded = await resetDb(db);
  });

  it("wczytuje pule A/B po nazwie DEX-u, syncs posortowane po (block, log_index), swapy i gaz tylko z okna", async () => {
    const [win] = await db
      .insert(schema.windows)
      .values({
        name: "test-window",
        fromTs: new Date("2021-05-14T00:00:00Z"),
        toTs: new Date("2021-05-14T01:00:00Z"),
        fromBlock: 100,
        toBlock: 110,
      })
      .returning();

    await db.insert(schema.syncEvents).values([
      // celowo nie w kolejności wstawiania -> sprawdzamy ORDER BY block, log_index
      { poolId: seeded.uniPoolId, block: 100, logIndex: 2, txHash: "0x" + "1".repeat(64), reserve0: "1000", reserve1: "2000" },
      { poolId: seeded.sushiPoolId, block: 100, logIndex: 1, txHash: "0x" + "2".repeat(64), reserve0: "1100", reserve1: "2100" },
      { poolId: seeded.uniPoolId, block: 105, logIndex: 1, txHash: "0x" + "3".repeat(64), reserve0: "1200", reserve1: "2200" },
      // poza oknem -> nie powinno się pojawić
      { poolId: seeded.uniPoolId, block: 99, logIndex: 1, txHash: "0x" + "4".repeat(64), reserve0: "1", reserve1: "1" },
      { poolId: seeded.uniPoolId, block: 111, logIndex: 1, txHash: "0x" + "5".repeat(64), reserve0: "1", reserve1: "1" },
    ]);

    await db.insert(schema.swapEvents).values([
      { poolId: seeded.uniPoolId, block: 101, logIndex: 1, txHash: "0x" + "6".repeat(64) },
      { poolId: seeded.sushiPoolId, block: 101, logIndex: 2, txHash: "0x" + "7".repeat(64) },
      { poolId: seeded.uniPoolId, block: 102, logIndex: 1, txHash: "0x" + "8".repeat(64) },
      // poza oknem
      { poolId: seeded.uniPoolId, block: 200, logIndex: 1, txHash: "0x" + "9".repeat(64) },
    ]);

    await db.insert(schema.blocks).values([
      { number: 100, timestamp: new Date("2021-05-14T00:00:00Z"), gasPriceMedian: "100000000000" }, // 100 gwei
      { number: 105, timestamp: new Date("2021-05-14T00:05:00Z"), gasPriceMedian: "150000000000" }, // 150 gwei
      { number: 101, timestamp: new Date("2021-05-14T00:01:00Z"), gasPriceMedian: null, txCount: 1 }, // brak gas_price_median
      { number: 200, timestamp: new Date("2021-05-14T03:20:00Z"), gasPriceMedian: "999000000000" }, // poza oknem
    ]);

    const inputs = await loadPairWindowInputs(db, seeded.pairId, win!.id);

    expect(inputs.pair).toMatchObject({ symbol: "WETH/USDC", decBase: 18, decQuote: 6, baseSymbol: "WETH", quoteSymbol: "USDC" });
    expect(inputs.window).toEqual({ id: win!.id, fromBlock: 100, toBlock: 110 });
    expect(inputs.poolA.poolId).toBe(seeded.uniPoolId);
    expect(inputs.poolA.feeBps).toBe(30);
    expect(inputs.poolB.poolId).toBe(seeded.sushiPoolId);

    expect(inputs.syncs.map((s) => [s.poolId, s.block, s.logIndex])).toEqual([
      [seeded.sushiPoolId, 100, 1],
      [seeded.uniPoolId, 100, 2],
      [seeded.uniPoolId, 105, 1],
    ]);
    expect(inputs.syncs[0]!.reserve0).toBe(1100n);
    expect(inputs.syncs[0]!.reserve1).toBe(2100n);

    expect(inputs.swapsPerBlock).toEqual(new Map([[101, 2], [102, 1]]));

    expect(inputs.gasSamples).toEqual([
      { block: 100, gwei: 100 },
      { block: 105, gwei: 150 },
    ]);
  });

  it("okno bez wypełnionego from_block/to_block -> błąd", async () => {
    const [win] = await db
      .insert(schema.windows)
      .values({ name: "not-ingested", fromTs: new Date("2021-05-14T00:00:00Z"), toTs: new Date("2021-05-14T01:00:00Z") })
      .returning();
    await expect(loadPairWindowInputs(db, seeded.pairId, win!.id)).rejects.toThrow(/nie zostało zingestowane/);
  });

  it("para bez jednej z pul (Uniswap/Sushiswap) -> błąd wymieniający symbol pary", async () => {
    await db.delete(schema.pools).where(eq(schema.pools.id, seeded.sushiPoolId));
    const [win] = await db
      .insert(schema.windows)
      .values({ name: "w", fromTs: new Date("2021-05-14T00:00:00Z"), toTs: new Date("2021-05-14T01:00:00Z"), fromBlock: 1, toBlock: 2 })
      .returning();
    await expect(loadPairWindowInputs(db, seeded.pairId, win!.id)).rejects.toThrow(/WETH\/USDC/);
  });

  it("gasSamples: tylko bloki ze zdarzeniami (Sync/Swap) PUL TEJ PARY — bloki innej pary są ignorowane (reprodukowalność niezależna od innych par)", async () => {
    const [win] = await db
      .insert(schema.windows)
      .values({
        name: "test-window-gas-per-pair",
        fromTs: new Date("2021-05-14T00:00:00Z"),
        toTs: new Date("2021-05-14T01:00:00Z"),
        fromBlock: 100,
        toBlock: 110,
      })
      .returning();

    // Zdarzenie tej pary (WETH/USDC) tylko w bloku 100.
    await db.insert(schema.syncEvents).values([
      { poolId: seeded.uniPoolId, block: 100, logIndex: 1, txHash: "0x" + "1".repeat(64), reserve0: "1000", reserve1: "2000" },
    ]);

    // Inna para (WBTC/WETH) z własną pulą na Uniswap V2 — zdarzenie w bloku 106, w oknie,
    // z wypełnionym gas_price_median -> pod starą logiką (dowolny blok okna) wpadłoby do
    // gasSamples tej pary, mimo że nie ma nic wspólnego z jej pulami.
    const WBTC = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";
    const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
    await db.insert(schema.tokens).values({ address: WBTC, symbol: "WBTC", decimals: 8 });
    const [otherPair] = await db
      .insert(schema.pairs)
      .values({ symbol: "WBTC/WETH", tokenBase: WBTC, tokenQuote: WETH })
      .returning();
    const [uniDex] = await db.select().from(schema.dexes).where(eq(schema.dexes.name, "uniswap-v2"));
    const [otherPool] = await db
      .insert(schema.pools)
      .values({ dexId: uniDex!.id, pairId: otherPair!.id, address: "0x" + "c".repeat(40), token0: WBTC, token1: WETH })
      .returning();
    await db.insert(schema.syncEvents).values([
      { poolId: otherPool!.id, block: 106, logIndex: 1, txHash: "0x" + "9".repeat(64), reserve0: "1", reserve1: "1" },
    ]);

    await db.insert(schema.blocks).values([
      { number: 100, timestamp: new Date("2021-05-14T00:00:00Z"), gasPriceMedian: "100000000000" }, // 100 gwei — blok TEJ pary
      { number: 106, timestamp: new Date("2021-05-14T00:06:00Z"), gasPriceMedian: "999000000000" }, // 999 gwei — blok INNEJ pary
    ]);

    const inputs = await loadPairWindowInputs(db, seeded.pairId, win!.id);
    expect(inputs.gasSamples).toEqual([{ block: 100, gwei: 100 }]);
  });
});
