// Test integracyjny zapisu block_states/opportunities na bazie testowej.
// Uruchomienie: DATABASE_URL_TEST=postgres://dexarb:dexarb@localhost:5433/dexarb_test npx vitest run packages/analysis
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { asc, eq } from "drizzle-orm";
import type { BlockStateRow } from "../src/analyzeWindow.js";
import { toDbDirection, writeBlockStates, writeOpportunities } from "../src/db.js";
import { detectOpportunities } from "../src/opportunities.js";
import { HAS_DB, resetDb, type Seeded } from "./helpers/db.js";

const row = (pairId: number, windowId: number, block: number, extra: Partial<BlockStateRow> = {}): BlockStateRow => ({
  pairId,
  windowId,
  block,
  priceA: 4000,
  priceB: 4000,
  spreadPct: 0.1,
  tvlMinUsd: 3e8,
  gasPriceMedian: 100,
  swapsInBlock: 2,
  s: 0.1,
  g: 0.1,
  l: 100,
  m: 30,
  optTradeUsd: 1000,
  baselineNetProfitUsd: -10,
  baselineFeasible: false,
  direction: "a->b",
  grossProfitUsd: 5,
  ...extra,
});

describe.skipIf(!HAS_DB)("writeBlockStates / writeOpportunities (integracja)", () => {
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
        name: "test-window",
        fromTs: new Date("2021-05-14T00:00:00Z"),
        toTs: new Date("2021-05-14T01:00:00Z"),
        fromBlock: 1,
        toBlock: 10,
      })
      .returning();
    windowId = win!.id;
  });

  const selectAll = () =>
    db
      .select()
      .from(schema.blockStates)
      .where(eq(schema.blockStates.pairId, seeded.pairId))
      .orderBy(asc(schema.blockStates.block));

  const boundsFor = (fromBlock: number, toBlock: number) => ({ pairId: seeded.pairId, windowId, fromBlock, toBlock });

  it("writeBlockStates jest idempotentny: dwukrotny zapis tych samych wierszy daje identyczne pełne wiersze", async () => {
    const rows = [
      row(seeded.pairId, windowId, 1, { priceA: 4000, priceB: 4010, spreadPct: 0.25, direction: "a->b" }),
      row(seeded.pairId, windowId, 2, {
        priceA: 4100,
        priceB: 4000,
        spreadPct: 2.4,
        direction: "b->a",
        baselineNetProfitUsd: 30,
        baselineFeasible: true,
      }),
    ];

    await writeBlockStates(db, rows, boundsFor(1, 10));
    const after1 = await selectAll();

    await writeBlockStates(db, rows, boundsFor(1, 10)); // drugi zapis — ma zbiegać (upsert), nie duplikować
    const after2 = await selectAll();

    expect(after1).toHaveLength(2);
    expect(after2).toEqual(after1); // pełne wiersze (select *), nie tylko wybrane kolumny
  });

  it("writeBlockStates usuwa wiersze spoza [fromBlock, toBlock] po zawężeniu okna (shrink)", async () => {
    const rowsFull = [1, 2, 3, 4, 5].map((b) => row(seeded.pairId, windowId, b));
    await writeBlockStates(db, rowsFull, boundsFor(1, 10));
    expect((await selectAll()).map((r) => r.block)).toEqual([1, 2, 3, 4, 5]);

    // okno zawężone do [3, 10] — bloki 1 i 2 wypadają spoza nowego zakresu i mają zniknąć,
    // mimo że writer dostaje tylko wiersze dla bloków, które nadal są w oknie (3–5)
    const rowsShrunk = [3, 4, 5].map((b) => row(seeded.pairId, windowId, b));
    await writeBlockStates(db, rowsShrunk, boundsFor(3, 10));
    expect((await selectAll()).map((r) => r.block)).toEqual([3, 4, 5]);

    // idempotentne: ponowny zapis z tymi samymi bounds/rows nic nie zmienia
    await writeBlockStates(db, rowsShrunk, boundsFor(3, 10));
    expect((await selectAll()).map((r) => r.block)).toEqual([3, 4, 5]);
  });

  it("writeBlockStates: zmiana wartości w ponownym zapisie aktualizuje wiersz (UPDATE, nie nowy wiersz) — wszystkie kolumny liczbowe", async () => {
    const initial = row(seeded.pairId, windowId, 1, {
      priceA: 4000,
      priceB: 4000,
      spreadPct: 0.1,
      tvlMinUsd: 3e8,
      gasPriceMedian: 100,
      swapsInBlock: 2,
      s: 0.1,
      g: 0.1,
      l: 100,
      m: 30,
      optTradeUsd: 1000,
      baselineNetProfitUsd: -10,
      baselineFeasible: false,
      direction: "a->b",
      grossProfitUsd: 5,
    });
    const updated = row(seeded.pairId, windowId, 1, {
      priceA: 4200,
      priceB: 4300,
      spreadPct: 5.0,
      tvlMinUsd: 5e8,
      gasPriceMedian: 250,
      swapsInBlock: 7,
      s: 0.9,
      g: 0.4,
      l: 60,
      m: 70,
      optTradeUsd: 8000,
      baselineNetProfitUsd: 300,
      baselineFeasible: true,
      direction: "b->a",
      grossProfitUsd: 320,
    });

    await writeBlockStates(db, [initial], boundsFor(1, 10));
    await writeBlockStates(db, [updated], boundsFor(1, 10));

    const stored = await selectAll();
    expect(stored).toHaveLength(1);
    // pełny wiersz po update — każda kolumna nie-kluczowa ma nową wartość z drugiego zapisu
    expect(stored[0]).toEqual({
      pairId: seeded.pairId,
      windowId,
      block: 1,
      priceA: 4200,
      priceB: 4300,
      spreadPct: 5.0,
      tvlMinUsd: 5e8,
      gasPriceMedian: 250,
      swapsInBlock: 7,
      s: 0.9,
      g: 0.4,
      l: 60,
      m: 70,
      optTradeUsd: 8000,
      baselineNetProfitUsd: 300,
      baselineFeasible: true,
      direction: toDbDirection("b->a"),
      grossProfitUsd: 320,
    });
  });

  it("writeOpportunities zbiega po ponownym uruchomieniu: usuwa okazje, które przestały przekraczać próg, zachowuje id pozostałych", async () => {
    const rows1 = [
      row(seeded.pairId, windowId, 1, { spreadPct: 1.0 }),
      row(seeded.pairId, windowId, 2, { spreadPct: 2.0, baselineNetProfitUsd: 12.5 }),
      row(seeded.pairId, windowId, 3, { spreadPct: 0.9 }),
    ];
    await writeOpportunities(db, seeded.pairId, windowId, detectOpportunities(rows1));

    const after1 = await db
      .select()
      .from(schema.opportunities)
      .where(eq(schema.opportunities.pairId, seeded.pairId))
      .orderBy(asc(schema.opportunities.block));
    expect(after1.map((o) => o.block)).toEqual([1, 2, 3]);
    const idBlock1 = after1.find((o) => o.block === 1)!.id;
    const idBlock3 = after1.find((o) => o.block === 3)!.id;

    // drugi przebieg: blok 2 spadł poniżej progu (spread się zmniejszył) -> ma zniknąć,
    // blok 1 i 3 zostają (i NIE zmieniają id — upsert, nie delete-all+insert)
    const rows2 = [
      row(seeded.pairId, windowId, 1, { spreadPct: 1.0 }),
      row(seeded.pairId, windowId, 2, { spreadPct: 0.1 }),
      row(seeded.pairId, windowId, 3, { spreadPct: 0.95, baselineNetProfitUsd: 1 }),
    ];
    await writeOpportunities(db, seeded.pairId, windowId, detectOpportunities(rows2));

    const after2 = await db
      .select()
      .from(schema.opportunities)
      .where(eq(schema.opportunities.pairId, seeded.pairId))
      .orderBy(asc(schema.opportunities.block));
    expect(after2.map((o) => o.block)).toEqual([1, 3]);
    expect(after2.find((o) => o.block === 1)!.id).toBe(idBlock1);
    expect(after2.find((o) => o.block === 3)!.id).toBe(idBlock3);
    expect(after2.find((o) => o.block === 3)!.estProfitUsd).toBe(1);
  });
});
