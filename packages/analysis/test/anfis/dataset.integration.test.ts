// Test integracyjny `loadLabeledRows` na bazie testowej: block_states LEFT
// JOIN opportunities LEFT JOIN opportunity_verifications.
// Uruchomienie: DATABASE_URL_TEST=postgres://dexarb:dexarb@localhost:5433/dexarb_test npx vitest run packages/analysis
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { buildDataset, loadLabeledRows } from "../../src/anfis/dataset.js";
import { HAS_DB, resetDb, type Seeded } from "../helpers/db.js";

const blockStateRow = (pairId: number, windowId: number, block: number, extra: Partial<typeof schema.blockStates.$inferInsert> = {}) => ({
  pairId,
  windowId,
  block,
  priceA: 4000,
  priceB: 4000,
  spreadPct: 0,
  tvlMinUsd: 1e6,
  gasPriceMedian: 100,
  swapsInBlock: 0,
  s: 0.1,
  g: 0.2,
  l: 100,
  m: 30,
  optTradeUsd: 0,
  baselineNetProfitUsd: 0,
  baselineFeasible: false,
  direction: "none" as const,
  grossProfitUsd: 0,
  ...extra,
});

describe.skipIf(!HAS_DB)("loadLabeledRows (integracja)", () => {
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
      .values({ name: "test-window", fromTs: new Date("2021-05-14T00:00:00Z"), toTs: new Date("2021-05-14T01:00:00Z"), fromBlock: 1, toBlock: 5 })
      .returning();
    windowId = win!.id;
  });

  it("łączy block_states z opportunities/opportunity_verifications: pozytyw, negatyw zweryfikowany, okazja niezweryfikowana, tło", async () => {
    // Blok 1: okazja, zweryfikowana, profitable_consumed=true (pozytyw)
    // Blok 2: okazja, zweryfikowana, profitable_consumed=false (negatyw)
    // Blok 3: okazja, BEZ weryfikacji
    // Bloki 4,5: tło (bez okazji)
    await db.insert(schema.blockStates).values([
      blockStateRow(seeded.pairId, windowId, 1, { s: 1.5 }),
      blockStateRow(seeded.pairId, windowId, 2, { s: 1.2 }),
      blockStateRow(seeded.pairId, windowId, 3, { s: 0.9 }),
      blockStateRow(seeded.pairId, windowId, 4, { s: 0.1 }),
      blockStateRow(seeded.pairId, windowId, 5, { s: 0.1 }),
    ]);
    const opps = await db
      .insert(schema.opportunities)
      .values([
        { pairId: seeded.pairId, windowId, block: 1, spreadPct: 1.5, direction: "a_to_b", estProfitUsd: 50 },
        { pairId: seeded.pairId, windowId, block: 2, spreadPct: 1.2, direction: "a_to_b", estProfitUsd: 30 },
        { pairId: seeded.pairId, windowId, block: 3, spreadPct: 0.9, direction: "b_to_a", estProfitUsd: 10 },
      ])
      .returning();
    const opp1 = opps.find((o) => o.block === 1)!;
    const opp2 = opps.find((o) => o.block === 2)!;
    await db.insert(schema.opportunityVerifications).values([
      { opportunityId: opp1.id, status: "consumed_atomic", route: "two_pool", profitableConsumed: true, realizedProfitUsd: 20, consumerTxHash: "0x" + "a".repeat(64) },
      { opportunityId: opp2.id, status: "consumed_atomic", route: "two_pool", profitableConsumed: false, realizedProfitUsd: -5, consumerTxHash: "0x" + "b".repeat(64) },
      // opp3 (block 3) celowo bez wiersza weryfikacji
    ]);

    const rows = await loadLabeledRows(db, [windowId]);
    expect(rows).toHaveLength(5);

    const byBlock = new Map(rows.map((r) => [r.block, r]));
    expect(byBlock.get(1)).toMatchObject({ isOpportunity: true, verified: true, label: 1, status: "consumed_atomic", route: "two_pool", realizedProfitUsd: 20 });
    expect(byBlock.get(2)).toMatchObject({ isOpportunity: true, verified: true, label: 0, status: "consumed_atomic", route: "two_pool", realizedProfitUsd: -5 });
    expect(byBlock.get(3)).toMatchObject({ isOpportunity: true, verified: false, label: 0, status: null, route: null, realizedProfitUsd: null });
    expect(byBlock.get(4)).toMatchObject({ isOpportunity: false, verified: false, label: 0 });
    expect(byBlock.get(5)).toMatchObject({ isOpportunity: false, verified: false, label: 0 });

    const d = buildDataset(rows, { negativesPerPositive: 10, seed: 1 });
    expect(d.meta).toEqual({ nPos: 1, nNeg: 1, nBackground: 2, windows: [windowId], nSkippedUnknown: 0 }); // tło: min(2, 10*1)=2
    expect(d.X).toHaveLength(4);
    expect(d.y.filter((v) => v === 1)).toHaveLength(1);
  });

  // `route='multi'` (kolumna z migracji 0005; uzasadnienie w `../verify/route.ts`) ma NIEZNANĄ
  // prawdziwą etykietę: `loadLabeledRows` musi przenieść `route` z bazy, a `buildDataset` musi taki
  // wiersz pominąć (nie liczyć jako negatyw mimo `profitableConsumed=false`) i zliczyć w
  // `meta.nSkippedUnknown`.
  it("okazja consumed_atomic z route='multi' jest pomijana przez buildDataset i zliczona w nSkippedUnknown", async () => {
    await db.insert(schema.blockStates).values([
      blockStateRow(seeded.pairId, windowId, 1, { s: 1.5 }), // pozytyw
      blockStateRow(seeded.pairId, windowId, 2, { s: 1.3 }), // consumed_atomic, multi-route -> nieznana etykieta
      blockStateRow(seeded.pairId, windowId, 3, { s: 0.1 }), // tło
    ]);
    const opps = await db
      .insert(schema.opportunities)
      .values([
        { pairId: seeded.pairId, windowId, block: 1, spreadPct: 1.5, direction: "a_to_b", estProfitUsd: 50 },
        { pairId: seeded.pairId, windowId, block: 2, spreadPct: 1.3, direction: "a_to_b", estProfitUsd: 40 },
      ])
      .returning();
    const opp1 = opps.find((o) => o.block === 1)!;
    const opp2 = opps.find((o) => o.block === 2)!;
    await db.insert(schema.opportunityVerifications).values([
      { opportunityId: opp1.id, status: "consumed_atomic", route: "two_pool", profitableConsumed: true, realizedProfitUsd: 20, consumerTxHash: "0x" + "a".repeat(64) },
      { opportunityId: opp2.id, status: "consumed_atomic", route: "multi", profitableConsumed: false, realizedProfitUsd: null, consumerTxHash: "0x" + "b".repeat(64) },
    ]);

    const rows = await loadLabeledRows(db, [windowId]);
    const byBlock = new Map(rows.map((r) => [r.block, r]));
    expect(byBlock.get(2)).toMatchObject({ isOpportunity: true, verified: true, status: "consumed_atomic", route: "multi", realizedProfitUsd: null });

    const d = buildDataset(rows, { negativesPerPositive: 10, seed: 1 });
    expect(d.meta).toEqual({ nPos: 1, nNeg: 0, nBackground: 1, windows: [windowId], nSkippedUnknown: 1 });
    expect(d.X).toHaveLength(2); // pozytyw (blok 1) + tło (blok 3) — blok 2 pominięty
  });

  it("zwraca pustą tablicę dla pustej listy windowIds (bez zapytania do bazy)", async () => {
    expect(await loadLabeledRows(db, [])).toEqual([]);
  });

  it("filtruje po windowId: okno bez block_states daje pustą tablicę", async () => {
    await db.insert(schema.blockStates).values([blockStateRow(seeded.pairId, windowId, 1)]);
    const [otherWin] = await db
      .insert(schema.windows)
      .values({ name: "other-window", fromTs: new Date("2021-05-15T00:00:00Z"), toTs: new Date("2021-05-15T01:00:00Z"), fromBlock: 100, toBlock: 105 })
      .returning();
    expect(await loadLabeledRows(db, [otherWin!.id])).toEqual([]);
    expect(await loadLabeledRows(db, [windowId])).toHaveLength(1);
  });
});
