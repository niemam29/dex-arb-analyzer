// Test integracyjny generalizacji kursu ETH/USD: para kwotowana w WETH
// (WBTC/WETH) bierze referencję z wcześniej przeanalizowanej pary WETH/USDC w tym samym oknie;
// brak referencji -> czytelny błąd po polsku; para z quote-stablecoinem (WETH/USDC) w ogóle
// referencji nie potrzebuje.
// Uruchomienie: DATABASE_URL_TEST=postgres://dexarb:dexarb@localhost:5433/dexarb_test npx vitest run packages/analysis
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { eq } from "drizzle-orm";
import { analyzePairWindow } from "../src/analyzePairWindow.js";
import { HAS_DB, resetDb, type Seeded } from "./helpers/db.js";

const WBTC = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

async function addWbtcWethPair(db: Db): Promise<{ pairId: number; uniPoolId: number; sushiPoolId: number }> {
  await db.insert(schema.tokens).values({ address: WBTC, symbol: "WBTC", decimals: 8 });
  const [pair] = await db
    .insert(schema.pairs)
    .values({ symbol: "WBTC/WETH", tokenBase: WBTC, tokenQuote: WETH })
    .returning();
  const [uniDex] = await db.select().from(schema.dexes).where(eq(schema.dexes.name, "uniswap-v2"));
  const [sushiDex] = await db.select().from(schema.dexes).where(eq(schema.dexes.name, "sushiswap"));
  const [uniPool] = await db
    .insert(schema.pools)
    .values({ dexId: uniDex!.id, pairId: pair!.id, address: "0x" + "a".repeat(40), token0: WBTC, token1: WETH })
    .returning();
  const [sushiPool] = await db
    .insert(schema.pools)
    .values({ dexId: sushiDex!.id, pairId: pair!.id, address: "0x" + "b".repeat(40), token0: WBTC, token1: WETH })
    .returning();
  // Bramka kompletności ingestu (ADR 0001): `analyzePairWindow` wymaga 100% pokrycia
  // OBU pul dla okna, inaczej rzuca przed zapisem — te testy sprawdzają generalizację kursu
  // ETH/USD, nie bramkę ingestu, więc pokrycie jest kompletne od razu (okno tu zawsze [100,100]).
  await db.insert(schema.ingestRanges).values([
    { poolId: uniPool!.id, fromBlock: 100, toBlock: 100, status: "done" },
    { poolId: sushiPool!.id, fromBlock: 100, toBlock: 100, status: "done" },
  ]);
  return { pairId: pair!.id, uniPoolId: uniPool!.id, sushiPoolId: sushiPool!.id };
}

describe.skipIf(!HAS_DB)("kurs ETH/USD dla par kwotowanych w WETH (referencja WETH/USDC)", () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let seeded: Seeded;
  let windowId: number;

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
    const [win] = await db
      .insert(schema.windows)
      .values({
        name: "test-window-ref-eth-usd",
        fromTs: new Date("2021-05-14T00:00:00Z"),
        toTs: new Date("2021-05-14T00:02:00Z"),
        fromBlock: 100,
        toBlock: 100,
      })
      .returning();
    windowId = win!.id;

    await db.insert(schema.blocks).values([
      { number: 100, timestamp: new Date("2021-05-14T00:00:00Z"), gasPriceMedian: "100000000000" }, // 100 gwei
    ]);

    // Bramka kompletności ingestu (ADR 0001 — patrz analyzePairWindow.integration.test.ts):
    // pokrycie referencyjnej pary WETH/USDC dla tego samego okna.
    await db.insert(schema.ingestRanges).values([
      { poolId: seeded.uniPoolId, fromBlock: 100, toBlock: 100, status: "done" },
      { poolId: seeded.sushiPoolId, fromBlock: 100, toBlock: 100, status: "done" },
    ]);
  });

  it("WBTC/WETH: bez wcześniejszej analizy WETH/USDC w tym oknie -> czytelny błąd po polsku", async () => {
    const { pairId, uniPoolId, sushiPoolId } = await addWbtcWethPair(db);
    await db.insert(schema.syncEvents).values([
      { poolId: uniPoolId, block: 100, logIndex: 1, txHash: `0x${"1".repeat(64)}`, reserve0: (100n * 10n ** 8n).toString(), reserve1: (1500n * 10n ** 18n).toString() },
      { poolId: sushiPoolId, block: 100, logIndex: 1, txHash: `0x${"2".repeat(64)}`, reserve0: (100n * 10n ** 8n).toString(), reserve1: (1500n * 10n ** 18n).toString() },
    ]);

    await expect(analyzePairWindow(db, { pairId, windowId })).rejects.toThrow(/WETH\/USDC/);
  });

  it("WBTC/WETH: po analizie referencyjnej WETH/USDC w tym oknie -> TVL/USD liczone z referencji", async () => {
    // Najpierw referencja: WETH/USDC, obie pule po 4000 USDC/WETH.
    await db.insert(schema.syncEvents).values([
      { poolId: seeded.uniPoolId, block: 100, logIndex: 1, txHash: `0x${"3".repeat(64)}`, reserve0: (4_000_000n * 10n ** 6n).toString(), reserve1: (1_000n * 10n ** 18n).toString() },
      { poolId: seeded.sushiPoolId, block: 100, logIndex: 1, txHash: `0x${"4".repeat(64)}`, reserve0: (4_000_000n * 10n ** 6n).toString(), reserve1: (1_000n * 10n ** 18n).toString() },
    ]);
    await analyzePairWindow(db, { pairId: seeded.pairId, windowId });

    const { pairId, uniPoolId, sushiPoolId } = await addWbtcWethPair(db);
    // 100 WBTC / 1500 WETH w obu pulach -> 15 WETH/WBTC, TVL w WETH = 2*1500 = 3000.
    await db.insert(schema.syncEvents).values([
      { poolId: uniPoolId, block: 100, logIndex: 1, txHash: `0x${"5".repeat(64)}`, reserve0: (100n * 10n ** 8n).toString(), reserve1: (1500n * 10n ** 18n).toString() },
      { poolId: sushiPoolId, block: 100, logIndex: 1, txHash: `0x${"6".repeat(64)}`, reserve0: (100n * 10n ** 8n).toString(), reserve1: (1500n * 10n ** 18n).toString() },
    ]);

    const res = await analyzePairWindow(db, { pairId, windowId });
    expect(res.blocks).toBe(1);

    const [row] = await db.select().from(schema.blockStates).where(eq(schema.blockStates.pairId, pairId));
    expect(row!.priceA).toBeCloseTo(15, 6); // 15 WETH/WBTC (cena WŁASNEJ puli, nie ETH/USD)
    // TVL: 2*1500 WETH x 4000 USD/WETH (referencja) = 12 000 000 USD.
    expect(Number(row!.tvlMinUsd)).toBeCloseTo(12_000_000, 0);
  });

  it("WETH/USDC (quote-stablecoin) analizuje się bez żadnej referencji", async () => {
    await db.insert(schema.syncEvents).values([
      { poolId: seeded.uniPoolId, block: 100, logIndex: 1, txHash: `0x${"7".repeat(64)}`, reserve0: (4_000_000n * 10n ** 6n).toString(), reserve1: (1_000n * 10n ** 18n).toString() },
      { poolId: seeded.sushiPoolId, block: 100, logIndex: 1, txHash: `0x${"8".repeat(64)}`, reserve0: (4_000_000n * 10n ** 6n).toString(), reserve1: (1_000n * 10n ** 18n).toString() },
    ]);
    const res = await analyzePairWindow(db, { pairId: seeded.pairId, windowId });
    expect(res.blocks).toBe(1);
  });
});
