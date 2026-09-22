// Test integracyjny scoring_models/model_scores na bazie testowej.
// Uruchomienie: DATABASE_URL_TEST=postgres://dexarb:dexarb@localhost:5433/dexarb_test npx vitest run packages/analysis
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { and, asc, eq } from "drizzle-orm";
import { DEFAULT_BASELINE_PARAMS, DEFAULT_MAMDANI_PARAMS, MamdaniModel } from "@dex-arb/core";
import type { BlockStateRow } from "../src/analyzeWindow.js";
import { ensureScoringModels, writeModelScores } from "../src/db.js";
import { scoreRows } from "../src/modelScores.js";
import { HAS_DB, resetDb, type Seeded } from "./helpers/db.js";

const row = (pairId: number, windowId: number, block: number, extra: Partial<BlockStateRow> = {}): BlockStateRow => ({
  pairId,
  windowId,
  block,
  priceA: 4000,
  priceB: 4000,
  spreadPct: 0,
  tvlMinUsd: 3e8,
  gasPriceMedian: 100,
  swapsInBlock: 0,
  s: 0,
  g: 0.1,
  l: 100,
  m: 30,
  optTradeUsd: 0,
  baselineNetProfitUsd: 0,
  baselineFeasible: false,
  direction: "none",
  grossProfitUsd: 0,
  ...extra,
});

/**
 * `writeModelScores` sprząta model_scores po blokach bez wiersza `block_states` (shrink okna) —
 * testy write* muszą więc mieć zasiane `block_states` dla używanych bloków, inaczej wszystko,
 * co właśnie zapisały, zostałoby natychmiast uznane za osierocone.
 */
const seedBlockStates = (db: Db, pairId: number, windowId: number, blocks: number[]) =>
  db.insert(schema.blockStates).values(
    blocks.map((block) => ({
      pairId,
      windowId,
      block,
      priceA: 4000,
      priceB: 4000,
      spreadPct: 0,
      tvlMinUsd: 1e6,
      gasPriceMedian: 100,
      swapsInBlock: 0,
      s: 0,
      g: 0,
      l: 100,
      m: 0,
      direction: "none" as const,
      grossProfitUsd: 0,
    })),
  );

describe.skipIf(!HAS_DB)("ensureScoringModels / scoreRows / writeModelScores (integracja)", () => {
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

  it("ensureScoringModels jest idempotentny: dwukrotne wywołanie daje te same id (upsert po name+version)", async () => {
    const first = await ensureScoringModels(db);
    const second = await ensureScoringModels(db);

    expect(first.map((m) => [m.kind, m.id])).toEqual(second.map((m) => [m.kind, m.id]));

    const stored = await db.select().from(schema.scoringModels).orderBy(asc(schema.scoringModels.name));
    expect(stored).toHaveLength(2); // baseline v1, mamdani v1 — nie zduplikowane
    expect(stored.map((s) => [s.name, s.version])).toEqual([
      ["baseline", 1],
      ["mamdani", 1],
    ]);
  });

  it("3-blokowa syntetyczna fixtura: hand-checked etykiety dla baseline i mamdani, zapisane do model_scores", async () => {
    const models = await ensureScoringModels(db);
    const baseline = models.find((m) => m.kind === "baseline")!;
    const mamdani = models.find((m) => m.kind === "mamdani")!;

    // Blok 1: brak spreadu, brak zysku -> niewykonalna dla obu modeli (S=0 wetuje R1 w mamdani).
    // Blok 2: umiarkowany spread, niski gaz, głęboka płynność, niskie MEV -> wykonalna (R5) w
    //   mamdani; baseline: dodatni zysk netto -> wykonalna.
    // Blok 3: duży spread, niski gaz, głęboka płynność, niskie MEV -> atrakcyjna (R10) w
    //   mamdani; baseline: wysoki dodatni zysk netto -> wykonalna (baseline nie zna "atrakcyjna").
    const rows = [
      row(seeded.pairId, windowId, 1, { s: 0, g: 0.1, l: 100, m: 20, optTradeUsd: 0, baselineNetProfitUsd: 0, baselineFeasible: false }),
      row(seeded.pairId, windowId, 2, { s: 0.9, g: 0.1, l: 100, m: 10, optTradeUsd: 5000, baselineNetProfitUsd: 20, baselineFeasible: true }),
      row(seeded.pairId, windowId, 3, { s: 2.0, g: 0.1, l: 100, m: 20, optTradeUsd: 20_000, baselineNetProfitUsd: 500, baselineFeasible: true }),
    ];

    const baselineScores = scoreRows(rows, baseline);
    const mamdaniScores = scoreRows(rows, mamdani);

    expect(baselineScores.map((s) => s.label)).toEqual(["niewykonalna", "wykonalna", "wykonalna"]);
    expect(mamdaniScores.map((s) => s.label)).toEqual(["niewykonalna", "wykonalna", "atrakcyjna"]);

    await seedBlockStates(db, seeded.pairId, windowId, [1, 2, 3]);
    await writeModelScores(db, [...baselineScores, ...mamdaniScores]);

    const stored = await db
      .select()
      .from(schema.modelScores)
      .where(eq(schema.modelScores.pairId, seeded.pairId))
      .orderBy(asc(schema.modelScores.modelId), asc(schema.modelScores.block));

    expect(stored).toHaveLength(6);
    expect(stored.filter((s) => s.modelId === baseline.id).map((s) => s.label)).toEqual([
      "niewykonalna",
      "wykonalna",
      "wykonalna",
    ]);
    expect(stored.filter((s) => s.modelId === mamdani.id).map((s) => s.label)).toEqual([
      "niewykonalna",
      "wykonalna",
      "atrakcyjna",
    ]);
  });

  it("writeModelScores jest idempotentny: dwukrotny zapis tych samych wierszy daje identyczne pełne wiersze", async () => {
    const models = await ensureScoringModels(db);
    const baseline = models.find((m) => m.kind === "baseline")!;
    const mamdani = models.find((m) => m.kind === "mamdani")!;
    const rows = [
      row(seeded.pairId, windowId, 1, { s: 0, g: 0.1, l: 100, m: 20, optTradeUsd: 0, baselineNetProfitUsd: 0, baselineFeasible: false }),
      row(seeded.pairId, windowId, 2, { s: 0.9, g: 0.1, l: 100, m: 10, optTradeUsd: 5000, baselineNetProfitUsd: 20, baselineFeasible: true }),
    ];
    const scores = [...scoreRows(rows, baseline), ...scoreRows(rows, mamdani)];
    await seedBlockStates(db, seeded.pairId, windowId, [1, 2]);

    const selectAll = () =>
      db
        .select()
        .from(schema.modelScores)
        .where(eq(schema.modelScores.pairId, seeded.pairId))
        .orderBy(asc(schema.modelScores.modelId), asc(schema.modelScores.block));

    await writeModelScores(db, scores);
    const after1 = await selectAll();

    await writeModelScores(db, scores); // drugi zapis — ma zbiegać (upsert), nie duplikować
    const after2 = await selectAll();

    expect(after1).toHaveLength(4);
    expect(after2).toEqual(after1); // pełne wiersze (select *), nie tylko wybrane kolumny
  });

  it("ensureScoringModels odświeża params wiersza baseline/mamdani v1 do definicji z kodu (v1 = kod, nie ręczna edycja w bazie)", async () => {
    await db.insert(schema.scoringModels).values([
      { name: "baseline", kind: "baseline", version: 1, params: { arbGas: 1, roiScale: 1 }, trainedOnWindowIds: [], metrics: {} },
      { name: "mamdani", kind: "mamdani", version: 1, params: { ...DEFAULT_MAMDANI_PARAMS, samples: 7 }, trainedOnWindowIds: [], metrics: {} },
    ]);

    await ensureScoringModels(db);

    const stored = await db.select().from(schema.scoringModels).orderBy(asc(schema.scoringModels.name));
    expect(stored.find((s) => s.name === "baseline")!.params).toEqual(DEFAULT_BASELINE_PARAMS);
    expect(stored.find((s) => s.name === "mamdani")!.params).toEqual(DEFAULT_MAMDANI_PARAMS);
  });

  it("model_scores buduje się z params zapisanych w bazie (round-trip jsonb): zmieniony term S.znikoma wyłącza R1 i daje inną etykietę niż domyślna", async () => {
    // R1 (S: "znikoma" -> niewykonalna) wetuje dla S bliskiego 0 pod domyślnymi parametrami
    // (invRamp(0.3, 0.65)) — przesuwamy "znikoma" daleko poza dziedzinę S, żeby przy S=0
    // miała przynależność 0 i R1 przestało się odpalać.
    const customParams = {
      ...DEFAULT_MAMDANI_PARAMS,
      inputs: {
        ...DEFAULT_MAMDANI_PARAMS.inputs,
        S: {
          ...DEFAULT_MAMDANI_PARAMS.inputs.S,
          terms: { ...DEFAULT_MAMDANI_PARAMS.inputs.S.terms, znikoma: { kind: "invRamp" as const, a: -10, b: -9 } },
        },
      },
    };
    const [inserted] = await db
      .insert(schema.scoringModels)
      .values({ name: "mamdani-custom", kind: "mamdani", version: 1, params: customParams, trainedOnWindowIds: [], metrics: {} })
      .returning();
    const [stored] = await db.select().from(schema.scoringModels).where(eq(schema.scoringModels.id, inserted!.id));

    const crisp = { S: 0, G: 0.1, L: 100, M: 20, netProfitUsd: 0, grossProfitUsd: 0, optTradeUsd: 0 };
    const fromDefault = new MamdaniModel();
    const fromDb = new MamdaniModel(stored!.params);
    const fromMemory = new MamdaniModel(customParams);

    expect(fromDefault.score(crisp).label).toBe("niewykonalna"); // R1 wetuje pod domyślnymi parametrami
    expect(fromDb.score(crisp)).toEqual(fromMemory.score(crisp)); // round-trip przez jsonb zachowuje zachowanie
    expect(fromDb.score(crisp).label).toBe("ryzykowna"); // żadna reguła się nie odpala -> fallback (środek dziedziny W)
    expect(fromDb.score(crisp).label).not.toBe(fromDefault.score(crisp).label);
  });

  it("writeModelScores usuwa wiersze modelu, których blok nie ma już block_states dla tej pary (shrink okna)", async () => {
    const models = await ensureScoringModels(db);
    const baseline = models.find((m) => m.kind === "baseline")!;

    await seedBlockStates(db, seeded.pairId, windowId, [1, 2]);

    await writeModelScores(db, scoreRows([row(seeded.pairId, windowId, 1), row(seeded.pairId, windowId, 2)], baseline));
    const afterFull = await db.select().from(schema.modelScores).where(eq(schema.modelScores.pairId, seeded.pairId));
    expect(afterFull.map((s) => s.block).sort((a, b) => a - b)).toEqual([1, 2]);

    // zawężenie okna: block_states dla bloku 1 znika (tak jak zrobiłby writeBlockStates po shrinku)
    await db.delete(schema.blockStates).where(and(eq(schema.blockStates.pairId, seeded.pairId), eq(schema.blockStates.block, 1)));

    await writeModelScores(db, scoreRows([row(seeded.pairId, windowId, 2)], baseline));
    const stored = await db.select().from(schema.modelScores).where(eq(schema.modelScores.pairId, seeded.pairId));
    expect(stored.map((s) => s.block)).toEqual([2]); // osierocony wiersz bloku 1 usunięty

    // idempotentne: ponowny zapis tych samych wierszy nic więcej nie zmienia
    await writeModelScores(db, scoreRows([row(seeded.pairId, windowId, 2)], baseline));
    const stored2 = await db.select().from(schema.modelScores).where(eq(schema.modelScores.pairId, seeded.pairId));
    expect(stored2.map((s) => s.block)).toEqual([2]);
  });

  it("writeModelScores: zmiana wartości w ponownym zapisie aktualizuje wiersz (UPDATE, nie nowy wiersz) — score I label", async () => {
    const models = await ensureScoringModels(db);
    const baseline = models.find((m) => m.kind === "baseline")!;
    await seedBlockStates(db, seeded.pairId, windowId, [1]);

    await writeModelScores(db, scoreRows([row(seeded.pairId, windowId, 1, {})], baseline));
    await writeModelScores(
      db,
      scoreRows([row(seeded.pairId, windowId, 1, { optTradeUsd: 1000, baselineNetProfitUsd: 10, baselineFeasible: true })], baseline),
    );

    const stored = await db.select().from(schema.modelScores).where(eq(schema.modelScores.pairId, seeded.pairId));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.label).toBe("wykonalna"); // było "niewykonalna" (baselineFeasible: false -> true)
    expect(stored[0]!.score).toBe(100); // roi = 10/1000 = 0.01 * roiScale(10_000) = 100; było 0 (netProfitUsd: 0)
  });
});
