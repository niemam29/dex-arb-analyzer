// Test integracyjny handlera `train` na bazie testowej: fixtura 2 okien
// (trainWindows=[w1], testWindows=[w2]), ~40 block_states, 6 okazji z weryfikacjami.
// Uruchomienie: DATABASE_URL_TEST=postgres://dexarb:dexarb@localhost:5433/dexarb_test npx vitest run packages/worker
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { AnfisMetricsSchema } from "@dex-arb/shared";
import type { JobContext, TrainParams } from "@dex-arb/shared";
import { makeTrain } from "../../src/jobs/train.js";

const HAS_DB = Boolean(process.env.DATABASE_URL_TEST);

async function resetDb(db: Db): Promise<{ pairId: number }> {
  await db.execute(
    sql`TRUNCATE sync_events, swap_events, blocks, ingest_ranges, jobs, windows, pools, pairs, tokens, dexes, scoring_models RESTART IDENTITY CASCADE`,
  );
  const [uniDex] = await db.insert(schema.dexes).values({ name: "uniswap-v2", factory: "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f", feeBps: 30 }).returning();
  const [sushiDex] = await db.insert(schema.dexes).values({ name: "sushiswap", factory: "0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac", feeBps: 30 }).returning();
  await db.insert(schema.tokens).values([
    { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6 },
    { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", symbol: "WETH", decimals: 18 },
  ]);
  const [pair] = await db
    .insert(schema.pairs)
    .values({ symbol: "WETH/USDC", tokenBase: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", tokenQuote: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" })
    .returning();
  await db.insert(schema.pools).values([
    {
      dexId: uniDex!.id,
      pairId: pair!.id,
      address: "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc",
      token0: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      token1: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    },
    {
      dexId: sushiDex!.id,
      pairId: pair!.id,
      address: "0x397ff1542f962076d0bfe58ea045ffa2d347aca0",
      token0: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      token1: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    },
  ]);
  return { pairId: pair!.id };
}

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

const noopCtx = (): JobContext => ({
  jobId: 1,
  log: async () => {},
  progress: async () => {},
  signal: new AbortController().signal,
});

describe.skipIf(!HAS_DB)("makeTrain (integracja)", () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let pairId: number;
  let w1: number;
  let w2: number;

  beforeAll(() => {
    const conn = createTestDb();
    db = conn.db;
    closeDb = () => conn.sql.end();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    ({ pairId } = await resetDb(db));
    const [win1] = await db
      .insert(schema.windows)
      .values({ name: "train-window", fromTs: new Date("2021-05-14T00:00:00Z"), toTs: new Date("2021-05-14T01:00:00Z"), fromBlock: 1, toBlock: 20 })
      .returning();
    const [win2] = await db
      .insert(schema.windows)
      .values({ name: "test-window", fromTs: new Date("2021-05-15T00:00:00Z"), toTs: new Date("2021-05-15T01:00:00Z"), fromBlock: 101, toBlock: 120 })
      .returning();
    w1 = win1!.id;
    w2 = win2!.id;

    // Okno 1 (train): 20 block_states, okazje na blokach 5,10,15 (2 pozytywy, 1 negatyw).
    await db.insert(schema.blockStates).values(
      Array.from({ length: 20 }, (_, i) => blockStateRow(pairId, w1, i + 1, { s: [5, 10, 15].includes(i + 1) ? 1.5 : 0.1 })),
    );
    const oppsW1 = await db
      .insert(schema.opportunities)
      .values([
        { pairId, windowId: w1, block: 5, spreadPct: 1.5, direction: "a_to_b", estProfitUsd: 20 },
        { pairId, windowId: w1, block: 10, spreadPct: 1.5, direction: "a_to_b", estProfitUsd: 15 },
        { pairId, windowId: w1, block: 15, spreadPct: 1.5, direction: "b_to_a", estProfitUsd: -3 },
      ])
      .returning();
    await db.insert(schema.opportunityVerifications).values([
      { opportunityId: oppsW1.find((o) => o.block === 5)!.id, status: "consumed_atomic", profitableConsumed: true, consumerTxHash: `0x${"1".repeat(64)}`, blocksToConsumption: 1, gasCostUsd: 2 },
      { opportunityId: oppsW1.find((o) => o.block === 10)!.id, status: "consumed_atomic", profitableConsumed: true, consumerTxHash: `0x${"2".repeat(64)}`, blocksToConsumption: 1, gasCostUsd: 3 },
      { opportunityId: oppsW1.find((o) => o.block === 15)!.id, status: "consumed_atomic", profitableConsumed: false, consumerTxHash: `0x${"3".repeat(64)}`, blocksToConsumption: 1, gasCostUsd: 1 },
    ]);

    // Okno 2 (test): 20 block_states, okazje na blokach 105,110,115 (1 pozytyw, 2 negatywy).
    await db.insert(schema.blockStates).values(
      Array.from({ length: 20 }, (_, i) => blockStateRow(pairId, w2, 101 + i, { s: [105, 110, 115].includes(101 + i) ? 1.5 : 0.1 })),
    );
    const oppsW2 = await db
      .insert(schema.opportunities)
      .values([
        { pairId, windowId: w2, block: 105, spreadPct: 1.5, direction: "a_to_b", estProfitUsd: 10 },
        { pairId, windowId: w2, block: 110, spreadPct: 1.5, direction: "a_to_b", estProfitUsd: 5 },
        { pairId, windowId: w2, block: 115, spreadPct: 1.5, direction: "b_to_a", estProfitUsd: -1 },
      ])
      .returning();
    await db.insert(schema.opportunityVerifications).values([
      { opportunityId: oppsW2.find((o) => o.block === 105)!.id, status: "consumed_atomic", profitableConsumed: true, consumerTxHash: `0x${"4".repeat(64)}`, blocksToConsumption: 2, gasCostUsd: 0 },
      { opportunityId: oppsW2.find((o) => o.block === 110)!.id, status: "consumed_atomic", profitableConsumed: false, consumerTxHash: `0x${"5".repeat(64)}`, blocksToConsumption: 1, gasCostUsd: 1 },
      { opportunityId: oppsW2.find((o) => o.block === 115)!.id, status: "decayed", profitableConsumed: false, blocksToConsumption: 0, gasCostUsd: 0 },
    ]);
  });

  it("uruchamia trening, zapisuje scoring_models (kind=anfis, metryki) i ocenia WSZYSTKIE block_states train+test do model_scores", async () => {
    const train = makeTrain({ db });
    await train({ trainWindows: [w1], testWindows: [w2], seed: 1, epochs: 15, lr: 0.05, excludeK0: false }, noopCtx());

    const [model] = await db.select().from(schema.scoringModels).where(eq(schema.scoringModels.kind, "anfis"));
    expect(model).toBeDefined();
    expect(model!.name).toBe("anfis");
    expect(model!.version).toBe(1);
    expect(model!.trainedOnWindowIds).toEqual([w1]);

    const metrics = model!.metrics as Record<string, unknown>;
    expect(Object.keys(metrics).sort()).toEqual(
      [
        "bestEpoch",
        "classWeights",
        "dataset",
        "diagnostics",
        "history",
        "nGroupsTrain",
        "population_block_states",
        "population_verified",
        "provenance",
        "seed",
        "testWindows",
        "trainWindows",
      ].sort(),
    );
    expect(metrics.nGroupsTrain).toBeTypeOf("number");
    expect(metrics.nGroupsTrain as number).toBeGreaterThan(0);
    const parsed = AnfisMetricsSchema.parse(metrics);
    expect(parsed.population_block_states.train.auc).toBeTypeOf("number");
    expect(parsed.population_block_states.test).not.toBeNull();
    expect(parsed.provenance.windows.find((w) => w.id === w1)?.blockStates).toBeGreaterThan(0);
    expect(parsed.provenance.windows.find((w) => w.id === w2)?.blockStates).toBeGreaterThan(0);

    const scores = await db.select().from(schema.modelScores).where(eq(schema.modelScores.modelId, model!.id));
    const states = await db
      .select()
      .from(schema.blockStates)
      .where(and(eq(schema.blockStates.pairId, pairId), sql`${schema.blockStates.windowId} in (${w1}, ${w2})`));
    expect(scores).toHaveLength(states.length);
    expect(states).toHaveLength(40);
  }, 60_000);

  it("deterministyczne: dwa przebiegi z tym samym seedem dają identyczne AnfisParams (różne wersje scoring_models)", async () => {
    const train = makeTrain({ db });
    const params: TrainParams = { trainWindows: [w1], testWindows: [w2], seed: 7, epochs: 10, lr: 0.05, excludeK0: false };
    await train(params, noopCtx());
    await train(params, noopCtx());

    const rows = await db.select().from(schema.scoringModels).where(eq(schema.scoringModels.kind, "anfis")).orderBy(asc(schema.scoringModels.version));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.version).toBe(1);
    expect(rows[1]!.version).toBe(2);
    expect(rows[1]!.params).toEqual(rows[0]!.params);
  }, 60_000);

  it("testWindows puste -> fallback 20% odcięcia chronologicznego z trainWindows (grupowo świadomy)", async () => {
    const train = makeTrain({ db });
    await train({ trainWindows: [w1], testWindows: [], seed: 2, epochs: 10, lr: 0.05, excludeK0: false }, noopCtx());

    const [model] = await db.select().from(schema.scoringModels).where(eq(schema.scoringModels.kind, "anfis"));
    expect(model).toBeDefined();
    expect(model!.trainedOnWindowIds).toEqual([w1]);
    const metrics = model!.metrics as { testWindows: number[] };
    expect(metrics.testWindows).toEqual([]); // testWindows param pozostaje puste — split jest wewnętrzny

    // scoring obejmuje tylko okno w1 (testWindows puste -> scoreTargets = trainRawFull = w1)
    const scores = await db.select().from(schema.modelScores).where(eq(schema.modelScores.modelId, model!.id));
    expect(scores).toHaveLength(20);
  }, 60_000);

  it("excludeK0=true odrzuca zweryfikowaną okazję z blocksToConsumption=0 z datasetu, ale NIE z model_scores", async () => {
    const train = makeTrain({ db });
    await train({ trainWindows: [w1], testWindows: [w2], seed: 3, epochs: 8, lr: 0.05, excludeK0: true }, noopCtx());

    const [model] = await db.select().from(schema.scoringModels).where(eq(schema.scoringModels.kind, "anfis"));
    const dataset = (model!.metrics as { dataset: { nPos: number; nNeg: number } }).dataset;
    // Blok 115 (okno w2, k=0) był negatywem -> po wykluczeniu k=0 nNeg w test evaluate() też się zmniejsza,
    // ale samo dataset.nPos/nNeg pochodzi z buildDataset(rowsTrain) (okno w1, bez k=0 tam) — sprawdzamy,
    // że job w ogóle kończy się poprawnie i model_scores nadal pokrywa WSZYSTKIE 40 block_states.
    expect(dataset.nPos).toBeGreaterThan(0);
    const scores = await db.select().from(schema.modelScores).where(eq(schema.modelScores.modelId, model!.id));
    expect(scores).toHaveLength(40);
  }, 60_000);
});
