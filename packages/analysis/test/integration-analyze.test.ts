// Test integracyjny orkiestracji `analyzePairWindow` na bazie testowej:
// syntetyczne 3-blokowe okno WETH/USDC — sprawdza liczby wierszy w block_states/opportunities/
// model_scores oraz idempotencję (dwa przebiegi -> identyczny wynik, bez duplikatów).
// Uruchomienie: DATABASE_URL_TEST=postgres://dexarb:dexarb@localhost:5433/dexarb_test npx vitest run packages/analysis
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { and, count, eq } from "drizzle-orm";
import { analyzePairWindow } from "../src/analyzePairWindow.js";
import { HAS_DB, resetDb, type Seeded } from "./helpers/db.js";

describe.skipIf(!HAS_DB)("analyzePairWindow (integracja, syntetyczne 3-blokowe okno)", () => {
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
        name: "test-window-analyze",
        fromTs: new Date("2021-05-14T00:00:00Z"),
        toTs: new Date("2021-05-14T00:03:00Z"),
        fromBlock: 100,
        toBlock: 102,
      })
      .returning();
    windowId = win!.id;

    // Blok 100: obie pule po 4000 USDC/WETH -> spread 0.
    // Blok 101: sushi drożeje do 4040 -> spread wobec uni (4000) ok. 1,0 % (> próg 0,65 %) -> okazja.
    // Blok 102: uni doganiaja do 4020 -> spread wobec sushi (4040, bez zmian) ok. 0,50 % (< próg) -> bez okazji.
    await db.insert(schema.syncEvents).values([
      { poolId: seeded.uniPoolId, block: 100, logIndex: 1, txHash: `0x${"1".repeat(64)}`, reserve0: "1000000000000", reserve1: "250000000000000000000" },
      { poolId: seeded.sushiPoolId, block: 100, logIndex: 1, txHash: `0x${"2".repeat(64)}`, reserve0: "1000000000000", reserve1: "250000000000000000000" },
      { poolId: seeded.sushiPoolId, block: 101, logIndex: 1, txHash: `0x${"3".repeat(64)}`, reserve0: "1010000000000", reserve1: "250000000000000000000" },
      { poolId: seeded.uniPoolId, block: 102, logIndex: 1, txHash: `0x${"4".repeat(64)}`, reserve0: "1005000000000", reserve1: "250000000000000000000" },
    ]);

    await db.insert(schema.blocks).values([
      { number: 100, timestamp: new Date("2021-05-14T00:00:00Z"), gasPriceMedian: "100000000000" },
      { number: 101, timestamp: new Date("2021-05-14T00:01:00Z"), gasPriceMedian: "100000000000" },
      { number: 102, timestamp: new Date("2021-05-14T00:02:00Z"), gasPriceMedian: "100000000000" },
    ]);

    // Bramka kompletności ingestu (ADR 0001 — patrz analyzePairWindow.integration.test.ts):
    // `analyzePairWindow` wymaga 100% pokrycia OBU pul dla okna, inaczej rzuca przed
    // zapisem — bez tych wpisów ten test (celowo testujący samą orkiestrację analizy, nie bramkę)
    // rzucałby zamiast wypełniać block_states/opportunities/model_scores.
    await db.insert(schema.ingestRanges).values([
      { poolId: seeded.uniPoolId, fromBlock: 100, toBlock: 102, status: "done" },
      { poolId: seeded.sushiPoolId, fromBlock: 100, toBlock: 102, status: "done" },
    ]);
  });

  it("wypełnia block_states/opportunities/model_scores; drugi przebieg jest identyczny (idempotencja)", async () => {
    const r1 = await analyzePairWindow(db, { pairId: seeded.pairId, windowId });

    expect(r1.blocks).toBe(3);
    expect(r1.opportunities).toBe(1);
    expect(Object.keys(r1.labelDistribution).sort()).toEqual(["baseline", "mamdani"]);
    for (const dist of Object.values(r1.labelDistribution)) {
      const sum = Object.values(dist).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(100, 6);
    }
    expect(r1.agreementMamdaniVsBaseline.auc).toBeTypeOf("number");

    const [{ n: nStates }] = await db.select({ n: count() }).from(schema.blockStates).where(eq(schema.blockStates.pairId, seeded.pairId));
    expect(nStates).toBe(r1.blocks);
    const [{ n: nOpp }] = await db
      .select({ n: count() })
      .from(schema.opportunities)
      .where(and(eq(schema.opportunities.pairId, seeded.pairId), eq(schema.opportunities.windowId, windowId)));
    expect(nOpp).toBe(r1.opportunities);
    const models = await db.select().from(schema.scoringModels);
    expect(models.map((m) => m.name).sort()).toEqual(["baseline", "mamdani"]);
    const [{ n: nScores }] = await db.select({ n: count() }).from(schema.modelScores).where(eq(schema.modelScores.pairId, seeded.pairId));
    expect(nScores).toBe(2 * r1.blocks);

    // Drugi przebieg (ta sama para/okno) ma zbiegać: identyczny wynik, bez duplikatów w bazie.
    const r2 = await analyzePairWindow(db, { pairId: seeded.pairId, windowId });
    expect(r2).toEqual(r1);

    const [{ n: nStates2 }] = await db.select({ n: count() }).from(schema.blockStates).where(eq(schema.blockStates.pairId, seeded.pairId));
    expect(nStates2).toBe(r1.blocks);
    const [{ n: nOpp2 }] = await db
      .select({ n: count() })
      .from(schema.opportunities)
      .where(and(eq(schema.opportunities.pairId, seeded.pairId), eq(schema.opportunities.windowId, windowId)));
    expect(nOpp2).toBe(r1.opportunities);
    const [{ n: nScores2 }] = await db.select({ n: count() }).from(schema.modelScores).where(eq(schema.modelScores.pairId, seeded.pairId));
    expect(nScores2).toBe(2 * r1.blocks);
  }, 30_000);

  it("raportuje log po polsku i progress rosnący do 1", async () => {
    const logs: string[] = [];
    const progresses: number[] = [];
    await analyzePairWindow(
      db,
      { pairId: seeded.pairId, windowId },
      {
        log: async (m) => {
          logs.push(m);
        },
        progress: async (f) => {
          progresses.push(f);
        },
      },
    );
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => /[ąćęłńóśźż]/.test(l.toLowerCase()))).toBe(true);
    expect(progresses.at(-1)).toBe(1);
    expect(progresses.every((f) => f >= 0 && f <= 1)).toBe(true);
    expect([...progresses].sort((a, b) => a - b)).toEqual(progresses);
  });
});
