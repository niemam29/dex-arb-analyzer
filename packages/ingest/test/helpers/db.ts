// Fixture testów integracyjnych warstwy DB ingestu: czyszczenie tabel + minimalne dane referencyjne
// (dex/tokeny/para/pula/okno), żeby testy nie zależały od danych seeda i były powtarzalne.
import { schema, type Db } from "@dex-arb/db";
import { sql } from "drizzle-orm";

/**
 * Testy integracyjne pomijane, gdy nie ma DATABASE_URL_TEST (np. na CI bez usługi bazy).
 * Celowo NIE ma fallbacku na DATABASE_URL — testy integracyjne robią TRUNCATE i muszą działać
 * wyłącznie na osobnej bazie testowej, nigdy na dev/prod.
 */
export const HAS_DB = Boolean(process.env.DATABASE_URL_TEST);

export async function resetDb(db: Db): Promise<{ poolId: number; windowId: number }> {
  // RESTART IDENTITY CASCADE: zeruje sekwencje (id od 1 w każdym teście) i czyści zależne wiersze.
  await db.execute(
    sql`TRUNCATE sync_events, swap_events, blocks, ingest_ranges, jobs, windows, pools, pairs, tokens, dexes RESTART IDENTITY CASCADE`,
  );
  // Nazwy/adresy zgodne z konwencją seeda (src/seed-data.ts, fix rundy poprawek 2): nazwa DEX-u
  // małymi literami z myślnikiem ("uniswap-v2", nie "Uniswap V2"), wszystkie adresy małymi literami
  // (char(42) porównywany case-sensitive w Postgresie — patrz docs/konwencje.md „Decyzje").
  const [dex] = await db
    .insert(schema.dexes)
    .values({ name: "uniswap-v2", factory: "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f", feeBps: 30 })
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
  const [pool] = await db
    .insert(schema.pools)
    .values({
      dexId: dex!.id,
      pairId: pair!.id,
      address: "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc",
      token0: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      token1: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    })
    .returning();
  const [win] = await db
    .insert(schema.windows)
    .values({ name: "test", fromTs: new Date("2021-05-14T00:00:00Z"), toTs: new Date("2021-05-27T00:00:00Z") })
    .returning();
  return { poolId: pool!.id, windowId: win!.id };
}
