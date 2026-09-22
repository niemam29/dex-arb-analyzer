// Test integracyjny bramki kompletności ingestu w `analyzePairWindow` (ADR 0001, "analyze
// gate on ingest completeness"): analiza NIE MOŻE ruszyć, dopóki OBIE pule (Uniswap V2 +
// Sushiswap) nie są w 100% zaingestowane dla całego okna — inaczej bloki bez Synca (bo jeszcze
// niezaingestowane) cicho dziedziczyłyby poprzedni stan rezerw jako "brak zmiany", zamiast
// zgłosić brakujące dane. Sama logika unii przedziałów jest w `loadPoolIngestCoverage`/
// `ensureIngestComplete` (src/db.ts) — tu tylko integracja z `analyzePairWindow` na bazie testowej.
// Uruchomienie: DATABASE_URL_TEST=postgres://dexarb:dexarb@localhost:5433/dexarb_test npx vitest run packages/analysis
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { count, eq } from "drizzle-orm";
import { analyzePairWindow } from "../src/analyzePairWindow.js";
import { HAS_DB, resetDb, type Seeded } from "./helpers/db.js";

describe.skipIf(!HAS_DB)("analyzePairWindow: bramka kompletności ingestu (ADR 0001)", () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let seeded: Seeded;
  let windowId: number;
  const fromBlock = 100;
  const toBlock = 102; // 3 bloki

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
        name: "test-window-ingest-gate",
        fromTs: new Date("2021-05-14T00:00:00Z"),
        toTs: new Date("2021-05-14T00:03:00Z"),
        fromBlock,
        toBlock,
      })
      .returning();
    windowId = win!.id;

    await db.insert(schema.syncEvents).values([
      { poolId: seeded.uniPoolId, block: 100, logIndex: 1, txHash: `0x${"1".repeat(64)}`, reserve0: "4000000000", reserve1: "1000000000000000000" },
      { poolId: seeded.sushiPoolId, block: 100, logIndex: 1, txHash: `0x${"2".repeat(64)}`, reserve0: "4000000000", reserve1: "1000000000000000000" },
    ]);
    await db.insert(schema.blocks).values([
      { number: 100, timestamp: new Date("2021-05-14T00:00:00Z"), gasPriceMedian: "100000000000" },
      { number: 101, timestamp: new Date("2021-05-14T00:01:00Z"), gasPriceMedian: "100000000000" },
      { number: 102, timestamp: new Date("2021-05-14T00:02:00Z"), gasPriceMedian: "100000000000" },
    ]);
  });

  it("ingest częściowy (jedna pula bez pokrycia) -> rzuca po polsku PRZED zapisem, wypisuje pokrycie obu pul", async () => {
    // Tylko pula Uniswap ma pełne pokrycie [100,102]; Sushiswap w ogóle nie ma wpisu w ingest_ranges.
    await db.insert(schema.ingestRanges).values([{ poolId: seeded.uniPoolId, fromBlock, toBlock, status: "done" }]);

    await expect(analyzePairWindow(db, { pairId: seeded.pairId, windowId })).rejects.toThrow(
      /ingest niekompletny/,
    );
    await expect(analyzePairWindow(db, { pairId: seeded.pairId, windowId })).rejects.toThrow(/sushiswap/);

    // Nic nie zostało zapisane (bramka jest PRZED writeBlockStates).
    const [{ n }] = await db.select({ n: count() }).from(schema.blockStates).where(eq(schema.blockStates.pairId, seeded.pairId));
    expect(n).toBe(0);
  });

  it("ingest częściowy (pokrycie tylko części okna) -> rzuca, mimo że część bloków JEST zaingestowana", async () => {
    await db.insert(schema.ingestRanges).values([
      { poolId: seeded.uniPoolId, fromBlock, toBlock, status: "done" },
      { poolId: seeded.sushiPoolId, fromBlock, toBlock: 101, status: "done" }, // brakuje bloku 102
    ]);

    await expect(analyzePairWindow(db, { pairId: seeded.pairId, windowId })).rejects.toThrow(
      /ingest niekompletny/,
    );
  });

  it("ingest pełny (obie pule 100% pokrycia okna) -> analiza rusza normalnie", async () => {
    await db.insert(schema.ingestRanges).values([
      { poolId: seeded.uniPoolId, fromBlock, toBlock, status: "done" },
      { poolId: seeded.sushiPoolId, fromBlock, toBlock, status: "done" },
    ]);

    const res = await analyzePairWindow(db, { pairId: seeded.pairId, windowId });
    expect(res.blocks).toBe(3);

    const [{ n }] = await db.select({ n: count() }).from(schema.blockStates).where(eq(schema.blockStates.pairId, seeded.pairId));
    expect(n).toBe(3);
  });

  it("ingest pełny złożony z NAKŁADAJĄCYCH SIĘ zakresów done (po ponownym ingeście) -> nadal 100%, nie >100%", async () => {
    await db.insert(schema.ingestRanges).values([
      { poolId: seeded.uniPoolId, fromBlock, toBlock, status: "done" },
      { poolId: seeded.uniPoolId, fromBlock, toBlock: 101, status: "done" }, // nakładający się, ten sam status
      { poolId: seeded.sushiPoolId, fromBlock, toBlock, status: "done" },
    ]);

    const res = await analyzePairWindow(db, { pairId: seeded.pairId, windowId });
    expect(res.blocks).toBe(3);
  });
});
