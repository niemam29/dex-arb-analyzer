// Test integracyjny handlera `calibrate:baseline_v2` na bazie testowej (DATABASE_URL_TEST):
// fixtura 2 okien, 40 block_states, 6 zweryfikowanych okazji (train 2 poz./1 neg., test 1/2).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { BaselineV2MetricsSchema } from "@dex-arb/shared";
import type { JobContext } from "@dex-arb/shared";
import { makeCalibrateBaselineV2 } from "../../src/jobs/calibrateBaselineV2.js";

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
    { dexId: uniDex!.id, pairId: pair!.id, address: "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc", token0: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", token1: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" },
    { dexId: sushiDex!.id, pairId: pair!.id, address: "0x397ff1542f962076d0bfe58ea045ffa2d347aca0", token0: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", token1: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" },
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

/** Okazja: brutto `gross`, koszt gazu v1 `gas` -> baseline_net = gross − gas. */
const opp = (gross: number, gas: number, optTradeUsd: number) => ({
  s: 1.5,
  direction: "a_to_b" as const,
  grossProfitUsd: gross,
  baselineNetProfitUsd: gross - gas,
  baselineFeasible: gross - gas > 0,
  optTradeUsd,
});

const noopCtx = (): JobContext => ({ jobId: 1, log: async () => {}, progress: async () => {}, signal: new AbortController().signal });

describe.skipIf(!HAS_DB)("makeCalibrateBaselineV2 (integracja)", () => {
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
    const [win1] = await db.insert(schema.windows).values({ name: "cal-window", fromTs: new Date("2021-05-14T00:00:00Z"), toTs: new Date("2021-05-14T01:00:00Z"), fromBlock: 1, toBlock: 20 }).returning();
    const [win2] = await db.insert(schema.windows).values({ name: "holdout-window", fromTs: new Date("2021-05-15T00:00:00Z"), toTs: new Date("2021-05-15T01:00:00Z"), fromBlock: 101, toBlock: 120 }).returning();
    w1 = win1!.id;
    w2 = win2!.id;

    // Okno 1: okazje 5 (poz., brutto 60, gaz v1 80 — netto v1 ujemne, ale bot płacił mniej), 10 (poz.), 15 (neg.).
    const oppW1: Record<number, ReturnType<typeof opp>> = { 5: opp(60, 80, 20_000), 10: opp(90, 40, 30_000), 15: opp(10, 80, 5_000) };
    await db.insert(schema.blockStates).values(Array.from({ length: 20 }, (_, i) => blockStateRow(pairId, w1, i + 1, oppW1[i + 1] ?? {})));
    const oppsW1 = await db
      .insert(schema.opportunities)
      .values([5, 10, 15].map((block) => ({ pairId, windowId: w1, block, spreadPct: 1.5, direction: "a_to_b" as const, estProfitUsd: 1 })))
      .returning();
    await db.insert(schema.opportunityVerifications).values([
      { opportunityId: oppsW1.find((o) => o.block === 5)!.id, status: "consumed_atomic", route: "two_pool", profitableConsumed: true, consumerTxHash: `0x${"1".repeat(64)}`, blocksToConsumption: 1, gasCostUsd: 40 },
      { opportunityId: oppsW1.find((o) => o.block === 10)!.id, status: "consumed_atomic", route: "two_pool", profitableConsumed: true, consumerTxHash: `0x${"2".repeat(64)}`, blocksToConsumption: 1, gasCostUsd: 20 },
      { opportunityId: oppsW1.find((o) => o.block === 15)!.id, status: "decayed", profitableConsumed: false, blocksToConsumption: null, gasCostUsd: null },
    ]);

    // Okno 2: 105 (poz.), 110 (neg.), 115 (neg., route multi — poza populacją).
    const oppW2: Record<number, ReturnType<typeof opp>> = { 105: opp(80, 50, 25_000), 110: opp(5, 50, 4_000), 115: opp(50, 50, 10_000) };
    await db.insert(schema.blockStates).values(Array.from({ length: 20 }, (_, i) => blockStateRow(pairId, w2, 101 + i, oppW2[101 + i] ?? {})));
    const oppsW2 = await db
      .insert(schema.opportunities)
      .values([105, 110, 115].map((block) => ({ pairId, windowId: w2, block, spreadPct: 1.5, direction: "a_to_b" as const, estProfitUsd: 1 })))
      .returning();
    await db.insert(schema.opportunityVerifications).values([
      { opportunityId: oppsW2.find((o) => o.block === 105)!.id, status: "consumed_atomic", route: "two_pool", profitableConsumed: true, consumerTxHash: `0x${"4".repeat(64)}`, blocksToConsumption: 2, gasCostUsd: 0 },
      { opportunityId: oppsW2.find((o) => o.block === 110)!.id, status: "consumed_atomic", route: "two_pool", profitableConsumed: false, consumerTxHash: `0x${"5".repeat(64)}`, blocksToConsumption: 1, gasCostUsd: 30 },
      { opportunityId: oppsW2.find((o) => o.block === 115)!.id, status: "consumed_atomic", route: "multi", profitableConsumed: false, consumerTxHash: `0x${"6".repeat(64)}`, blocksToConsumption: 1, gasCostUsd: 30 },
    ]);
  });

  it("zapisuje scoring_models (kind=baseline_v2, params, metrics, trained_on_window_ids) i ocenia WSZYSTKIE block_states train+test", async () => {
    const calibrate = makeCalibrateBaselineV2({ db });
    await calibrate({ trainWindows: [w1], testWindows: [w2] }, noopCtx());

    const [model] = await db.select().from(schema.scoringModels).where(eq(schema.scoringModels.kind, "baseline_v2"));
    expect(model).toBeDefined();
    expect(model!.name).toBe("baseline_v2");
    expect(model!.version).toBe(1);
    expect(model!.trainedOnWindowIds).toEqual([w1]);

    const params = model!.params as Record<string, unknown>;
    expect(Object.keys(params).sort()).toEqual(["arbGasRef", "gasPriceFactor", "gasUnits", "optTradeQuantiles", "scale", "threshold", "weightOptTrade"]);
    expect(params.arbGasRef).toBe(220_000);
    expect([150_000, 220_000]).toContain(params.gasUnits);

    const metrics = BaselineV2MetricsSchema.parse(model!.metrics);
    expect(metrics.population).toBe("verified_opportunities");
    expect(metrics.calibration).toMatchObject({ n: 3, positives: 2 });
    expect(metrics.calibration.auc).toBe(1); // pozytywy mają wyższe brutto niż negatyw — separowalne
    expect(metrics.holdout).toMatchObject({ n: 2, positives: 1 }); // 115 (multi) wykluczony
    expect(metrics.grid).toHaveLength(30);
    expect(metrics.provenance.windows.find((w) => w.id === w1)?.blockStates).toBeGreaterThan(0);
    expect(metrics.provenance.windows.find((w) => w.id === w2)?.blockStates).toBeGreaterThan(0);

    const scores = await db.select().from(schema.modelScores).where(eq(schema.modelScores.modelId, model!.id));
    const states = await db.select().from(schema.blockStates).where(and(eq(schema.blockStates.pairId, pairId), sql`${schema.blockStates.windowId} in (${w1}, ${w2})`));
    expect(states).toHaveLength(40);
    expect(scores).toHaveLength(40);
    // tło (brutto 0) oceniane poniżej progu; pozytyw kalibracyjny (blok 10) powyżej
    const byBlock = new Map(scores.map((s) => [s.block, s]));
    expect(byBlock.get(1)!.score).toBeLessThan(50);
    expect(byBlock.get(1)!.label).toBe("niewykonalna");
    expect(byBlock.get(10)!.score).toBeGreaterThanOrEqual(50);
  }, 30_000);

  it("deterministyczne: dwa przebiegi dają identyczne params (kolejne wersje); testWindows puste -> holdout null, ocena tylko okna train", async () => {
    const calibrate = makeCalibrateBaselineV2({ db });
    await calibrate({ trainWindows: [w1], testWindows: [] }, noopCtx());
    await calibrate({ trainWindows: [w1], testWindows: [] }, noopCtx());

    const rows = await db.select().from(schema.scoringModels).where(eq(schema.scoringModels.kind, "baseline_v2")).orderBy(asc(schema.scoringModels.version));
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    expect(rows[1]!.params).toEqual(rows[0]!.params);
    expect((rows[0]!.metrics as { holdout: unknown }).holdout).toBeNull();
    const scores = await db.select().from(schema.modelScores).where(eq(schema.modelScores.modelId, rows[0]!.id));
    expect(scores).toHaveLength(20);
  }, 30_000);
});
