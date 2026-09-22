// Helper testów integracyjnych API: połączenie z bazą TESTOWĄ (WYŁĄCZNIE DATABASE_URL_TEST — nigdy
// DATABASE_URL, patrz `createTestDb` w `@dex-arb/db`), reset przez TRUNCATE oraz zasiew minimalnego
// katalogu (DEX-y, tokeny, para, pula, okno, model). Samodzielny (testy pakietu `api` nie importują
// z katalogu testowego innego pakietu). Migracje są już zaaplikowane na bazie testowej
// (`npm run db:migrate:test`) — helper ich nie uruchamia.
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { sql } from "drizzle-orm";

/** Testy integracyjne api pomijane, gdy nie ma DATABASE_URL_TEST (czysty klon, CI bez bazy) —
 * ten sam wzorzec co `packages/analysis/test/helpers/db.ts`. `testDb()` wolno wołać dopiero w
 * `beforeAll` wewnątrz `describe.skipIf(!HAS_DB)`, nigdy na poziomie modułu. */
export const HAS_DB = Boolean(process.env.DATABASE_URL_TEST);

export interface SeedIds {
  pairId: number;
  windowId: number;
  poolA: number;
  poolB: number;
  modelId: number;
}

export interface TestDb {
  db: Db;
  reset(): Promise<void>;
  seedCatalog(): Promise<SeedIds>;
  close(): Promise<void>;
}

export async function testDb(): Promise<TestDb> {
  const { db, sql: client } = createTestDb();

  async function reset(): Promise<void> {
    // scoring_models nie ma FK do pairs/windows, więc TRUNCATE ... CASCADE go nie obejmuje
    // automatycznie — wypisany jawnie (jak w packages/analysis/test/helpers/db.ts).
    await db.execute(sql`
      TRUNCATE model_scores, opportunity_verifications, opportunities, block_states,
        sync_events, swap_events, blocks, ingest_ranges, jobs, windows, pools, pairs,
        tokens, dexes, scoring_models
      RESTART IDENTITY CASCADE
    `);
  }

  async function seedCatalog(): Promise<SeedIds> {
    const [uniDex] = await db
      .insert(schema.dexes)
      .values({ name: "Uniswap V2", factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", feeBps: 30 })
      .returning();
    const [sushiDex] = await db
      .insert(schema.dexes)
      .values({ name: "Sushiswap", factory: "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac", feeBps: 30 })
      .returning();
    await db.insert(schema.tokens).values([
      { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6 },
      { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", decimals: 18 },
    ]);
    const [pair] = await db
      .insert(schema.pairs)
      .values({
        symbol: "WETH/USDC",
        tokenBase: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        tokenQuote: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      })
      .returning();
    const [poolA] = await db
      .insert(schema.pools)
      .values({
        dexId: uniDex!.id,
        pairId: pair!.id,
        address: "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc",
        token0: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        token1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      })
      .returning();
    const [poolB] = await db
      .insert(schema.pools)
      .values({
        dexId: sushiDex!.id,
        pairId: pair!.id,
        address: "0x397FF1542f962076d0BFE58eA045FfA2d347ACa0",
        token0: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        token1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      })
      .returning();
    const [win] = await db
      .insert(schema.windows)
      .values({
        name: "test-okno",
        fromTs: new Date("2021-05-14T00:00:00Z"),
        toTs: new Date("2021-05-14T01:00:00Z"),
        fromBlock: 1000,
        toBlock: 1999,
      })
      .returning();
    const [model] = await db
      .insert(schema.scoringModels)
      .values({ name: "baseline", kind: "baseline", version: 1, params: {} })
      .returning();

    return {
      pairId: pair!.id,
      windowId: win!.id,
      poolA: poolA!.id,
      poolB: poolB!.id,
      modelId: model!.id,
    };
  }

  return { db, reset, seedCatalog, close: () => client.end() };
}
