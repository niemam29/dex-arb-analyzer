// Fixture testu integracyjnego `loadPairWindowInputs`: czyszczenie tabel +
// minimalne dane referencyjne (2 DEX-y, tokeny, para, 2 pule, okno) — wzorowane na
// `packages/ingest/test/helpers/db.ts`, ale samodzielne (dotyka wyłącznie
// `packages/analysis/**`, więc nie importuje testowych helperów z innego pakietu).
import { schema, type Db } from "@dex-arb/db";
import { sql } from "drizzle-orm";

/** Testy integracyjne pomijane, gdy nie ma DATABASE_URL_TEST (np. CI bez usługi bazy). */
export const HAS_DB = Boolean(process.env.DATABASE_URL_TEST);

export interface Seeded {
  pairId: number;
  uniPoolId: number;
  sushiPoolId: number;
}

export async function resetDb(db: Db): Promise<Seeded> {
  // scoring_models nie ma FK do pairs/windows, więc TRUNCATE ... CASCADE go nie obejmuje
  // automatycznie (w przeciwieństwie do block_states/opportunities/model_scores, które
  // referencjonują pairs/windows i są sprzątane kaskadowo) — wypisany jawnie.
  await db.execute(
    sql`TRUNCATE sync_events, swap_events, blocks, ingest_ranges, jobs, windows, pools, pairs, tokens, dexes, scoring_models RESTART IDENTITY CASCADE`,
  );
  const [uniDex] = await db
    .insert(schema.dexes)
    .values({ name: "uniswap-v2", factory: "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f", feeBps: 30 })
    .returning();
  const [sushiDex] = await db
    .insert(schema.dexes)
    .values({ name: "sushiswap", factory: "0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac", feeBps: 30 })
    .returning();
  await db.insert(schema.tokens).values([
    { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6 },
    { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", symbol: "WETH", decimals: 18 },
  ]);
  const [pair] = await db
    .insert(schema.pairs)
    .values({
      symbol: "WETH/USDC",
      tokenBase: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      tokenQuote: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    })
    .returning();
  const [uniPool] = await db
    .insert(schema.pools)
    .values({
      dexId: uniDex!.id,
      pairId: pair!.id,
      address: "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc",
      token0: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      token1: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    })
    .returning();
  const [sushiPool] = await db
    .insert(schema.pools)
    .values({
      dexId: sushiDex!.id,
      pairId: pair!.id,
      address: "0x397ff1542f962076d0bfe58ea045ffa2d347aca0",
      token0: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      token1: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    })
    .returning();
  return { pairId: pair!.id, uniPoolId: uniPool!.id, sushiPoolId: sushiPool!.id };
}
