// Test integracyjny `runVerifyPairWindow` + `createDrizzleVerifyRepo` na realnej bazie testowej.
// Fixture: 2 pule (Uniswap V2/Sushiswap, z `resetDb`), okno, block_states dla
// B..B+K_MAX, 3 okazje (consumed_atomic / consumed_partial / decayed) i swapy — w tym jedna
// atomowa tx (obie pule, ta sama tx). RPC mockowany (bez sieci) — zwraca spreparowany receipt z
// logiem Transfer. Uruchomienie:
// DATABASE_URL_TEST=postgres://dexarb:dexarb@localhost:5433/dexarb_test npx vitest run packages/analysis
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { asc, eq } from "drizzle-orm";
import type { JobContext } from "@dex-arb/shared";
import { createDrizzleVerifyRepo, runVerifyPairWindow } from "../../src/verify/verify-job.js";
import type { RpcLike, RpcRequest } from "../../src/verify/receipt.js";
import { HAS_DB, resetDb, type Seeded } from "../helpers/db.js";

const TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const BOT = "0x" + "b".repeat(40);
const tx = (n: number) => "0x" + n.toString().padStart(64, "0");

/** Receipt spreparowany: tx udana, przelew 100 USDC do BOT (profit brutto 100 USD). */
const rawReceipt = (hash: string) => ({
  transactionHash: hash,
  from: BOT,
  gasUsed: "0x30d40", // 200 000
  effectiveGasPrice: "0x174876e800", // 100 gwei
  status: "0x1",
  logs: [
    {
      address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC (quote)
      topics: [TOPIC, "0x" + "1".repeat(64), "0x" + BOT.slice(2).padStart(64, "0")],
      data: "0x" + (100_000000n).toString(16).padStart(64, "0"),
    },
  ],
});

function fakeRpc(): RpcLike & { batch: ReturnType<typeof vi.fn> } {
  return { batch: vi.fn(async (reqs: RpcRequest[]) => reqs.map((r) => rawReceipt(r.params[0] as string))) };
}

function fakeCtx(): JobContext & { log: ReturnType<typeof vi.fn>; progress: ReturnType<typeof vi.fn> } {
  return { jobId: 1, log: vi.fn(async () => {}), progress: vi.fn(async () => {}), signal: new AbortController().signal };
}

describe.skipIf(!HAS_DB)("runVerifyPairWindow + createDrizzleVerifyRepo (integracja)", () => {
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
      .values({ name: "verify-test-window", fromTs: new Date("2021-05-14T00:00:00Z"), toTs: new Date("2021-05-14T01:00:00Z"), fromBlock: 90, toBlock: 310 })
      .returning();
    windowId = win!.id;

    await db.insert(schema.blockStates).values([
      // opp #1 (block 100): kandydat atomowy w bloku 101.
      { pairId: seeded.pairId, windowId, block: 100, priceA: 3000, priceB: 3030, spreadPct: 1.0, tvlMinUsd: 1e8, s: 1, g: 1, l: 1, m: 1, direction: "a_to_b" as const, grossProfitUsd: 0 },
      { pairId: seeded.pairId, windowId, block: 101, priceA: 3000, priceB: 3003, spreadPct: 0.1, tvlMinUsd: 1e8, s: 1, g: 1, l: 1, m: 1, direction: "a_to_b" as const, grossProfitUsd: 0 },
      // opp #2 (block 200): swap częściowo zawężający spread w bloku 201.
      { pairId: seeded.pairId, windowId, block: 200, priceA: 3000, priceB: 3027, spreadPct: 0.9, tvlMinUsd: 1e8, s: 1, g: 1, l: 1, m: 1, direction: "a_to_b" as const, grossProfitUsd: 0 },
      { pairId: seeded.pairId, windowId, block: 201, priceA: 3000, priceB: 3006, spreadPct: 0.2, tvlMinUsd: 1e8, s: 1, g: 1, l: 1, m: 1, direction: "a_to_b" as const, grossProfitUsd: 0 },
      // opp #3 (block 300): spread spada w bloku 301, ale bez swapu w naszych pulach -> decayed.
      { pairId: seeded.pairId, windowId, block: 300, priceA: 3000, priceB: 3024, spreadPct: 0.8, tvlMinUsd: 1e8, s: 1, g: 1, l: 1, m: 1, direction: "a_to_b" as const, grossProfitUsd: 0 },
      { pairId: seeded.pairId, windowId, block: 301, priceA: 3000, priceB: 3003, spreadPct: 0.1, tvlMinUsd: 1e8, s: 1, g: 1, l: 1, m: 1, direction: "a_to_b" as const, grossProfitUsd: 0 },
    ]);

    await db.insert(schema.opportunities).values([
      { pairId: seeded.pairId, windowId, block: 100, spreadPct: 1.0, direction: "a_to_b" },
      { pairId: seeded.pairId, windowId, block: 200, spreadPct: 0.9, direction: "a_to_b" },
      { pairId: seeded.pairId, windowId, block: 300, spreadPct: 0.8, direction: "a_to_b" },
    ]);

    await db.insert(schema.swapEvents).values([
      // Tx atomowa w bloku 101: kup WETH na Uniswap (A, tańsza), sprzedaj na Sushiswap (B, droższa).
      {
        poolId: seeded.uniPoolId, block: 101, logIndex: 1, txHash: tx(1), sender: BOT, to: BOT,
        amount0In: "3000000000", amount0Out: "0", amount1In: "0", amount1Out: "1000000000000000000",
      },
      {
        poolId: seeded.sushiPoolId, block: 101, logIndex: 2, txHash: tx(1), sender: BOT, to: BOT,
        amount0In: "0", amount0Out: "3020000000", amount1In: "1000000000000000000", amount1Out: "0",
      },
      // Swap zawężający spread w bloku 201 (tylko Sushiswap — sprzedaż w droższej puli).
      {
        poolId: seeded.sushiPoolId, block: 201, logIndex: 1, txHash: tx(2), sender: BOT, to: BOT,
        amount0In: "0", amount0Out: "3010000000", amount1In: "1000000000000000000", amount1Out: "0",
      },
    ]);
  });

  const selectVerifications = () =>
    db
      .select({
        block: schema.opportunities.block,
        status: schema.opportunityVerifications.status,
        consumerTxHash: schema.opportunityVerifications.consumerTxHash,
        realizedProfitUsd: schema.opportunityVerifications.realizedProfitUsd,
        gasUsed: schema.opportunityVerifications.gasUsed,
        gasCostUsd: schema.opportunityVerifications.gasCostUsd,
        blocksToConsumption: schema.opportunityVerifications.blocksToConsumption,
        profitableConsumed: schema.opportunityVerifications.profitableConsumed,
        route: schema.opportunityVerifications.route,
        verifiedAt: schema.opportunityVerifications.verifiedAt,
      })
      .from(schema.opportunityVerifications)
      .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.opportunityVerifications.opportunityId))
      .orderBy(asc(schema.opportunities.block));

  it("klasyfikuje 3 okazje (atomic/partial/decayed) i zapisuje opportunity_verifications", async () => {
    const repo = createDrizzleVerifyRepo(db);
    const summary = await runVerifyPairWindow({ pairId: seeded.pairId, windowId }, { repo, rpc: fakeRpc(), ctx: fakeCtx() });

    expect(summary.total).toBe(3);
    expect(summary.byStatus).toMatchObject({ consumed_atomic: 1, consumed_partial: 1, decayed: 1, persisted: 0 });

    const rows = await selectVerifications();
    expect(rows).toHaveLength(3);

    const atomic = rows.find((r) => r.block === 100)!;
    expect(atomic.status).toBe("consumed_atomic");
    expect(atomic.consumerTxHash).toBe(tx(1));
    expect(atomic.realizedProfitUsd).toBeCloseTo(100, 6);
    expect(atomic.gasUsed).toBe("200000");
    expect(Number(atomic.gasCostUsd)).toBeGreaterThan(0);
    expect(atomic.blocksToConsumption).toBe(1);
    expect(atomic.profitableConsumed).toBe(true);
    expect(atomic.route).toBe("two_pool");

    const partial = rows.find((r) => r.block === 200)!;
    expect(partial.status).toBe("consumed_partial");
    expect(partial.consumerTxHash).toBe(tx(2));
    expect(partial.blocksToConsumption).toBe(1);
    expect(partial.realizedProfitUsd).toBeNull();
    expect(partial.route).toBeNull();

    const decayed = rows.find((r) => r.block === 300)!;
    expect(decayed.status).toBe("decayed");
    expect(decayed.consumerTxHash).toBeNull();
    expect(decayed.blocksToConsumption).toBe(1);
    expect(decayed.route).toBeNull();
  });

  it("trasa multi (obcy Swap V2 w receipcie) persystuje route='multi', realized_profit_usd NULL, profitable_consumed=false (CHECK-i migracji 0005 spełnione); re-run z two_pool nadpisuje route przez ON CONFLICT", async () => {
    const repo = createDrizzleVerifyRepo(db);
    const TOPIC_SWAP_V2 = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
    const multiRpc: RpcLike = {
      batch: vi.fn(async (reqs: RpcRequest[]) =>
        reqs.map((r) => {
          const base = rawReceipt(r.params[0] as string);
          // Swap V2 z TRZECIEJ puli (adres spoza pary) — classifyRoute -> 'multi'.
          return { ...base, logs: [...base.logs, { address: "0x" + "cc".repeat(20), topics: [TOPIC_SWAP_V2], data: "0x" }] };
        }),
      ),
    };
    const summary = await runVerifyPairWindow({ pairId: seeded.pairId, windowId }, { repo, rpc: multiRpc, ctx: fakeCtx() });
    expect(summary.byRoute).toEqual({ two_pool: 0, multi: 1 });

    const multi = (await selectVerifications()).find((r) => r.block === 100)!;
    expect(multi.status).toBe("consumed_atomic");
    expect(multi.route).toBe("multi");
    expect(multi.realizedProfitUsd).toBeNull();
    expect(multi.profitableConsumed).toBe(false);
    expect(Number(multi.gasCostUsd)).toBeGreaterThan(0);

    // ON CONFLICT DO UPDATE ustawia też `route`: reweryfikacja czystym receiptem -> two_pool.
    await runVerifyPairWindow({ pairId: seeded.pairId, windowId, force: true }, { repo, rpc: fakeRpc(), ctx: fakeCtx() });
    const twoPool = (await selectVerifications()).find((r) => r.block === 100)!;
    expect(twoPool.route).toBe("two_pool");
    expect(twoPool.realizedProfitUsd).toBeCloseTo(100, 6);
    expect(twoPool.profitableConsumed).toBe(true);
  });

  it("domyślnie pomija już zweryfikowane okazje (skipVerified); force=true reweryfikuje", async () => {
    const repo = createDrizzleVerifyRepo(db);
    await runVerifyPairWindow({ pairId: seeded.pairId, windowId }, { repo, rpc: fakeRpc(), ctx: fakeCtx() });

    const second = await runVerifyPairWindow({ pairId: seeded.pairId, windowId }, { repo, rpc: fakeRpc(), ctx: fakeCtx() });
    expect(second.total).toBe(0);

    const forced = await runVerifyPairWindow({ pairId: seeded.pairId, windowId, force: true }, { repo, rpc: fakeRpc(), ctx: fakeCtx() });
    expect(forced.total).toBe(3);
  });

  it("idempotencja: dwa przebiegi z force=true dają identyczne wiersze (poza verified_at)", async () => {
    const repo = createDrizzleVerifyRepo(db);
    await runVerifyPairWindow({ pairId: seeded.pairId, windowId, force: true }, { repo, rpc: fakeRpc(), ctx: fakeCtx() });
    const first = (await selectVerifications()).map((r) => ({ ...r, verifiedAt: null }));

    await runVerifyPairWindow({ pairId: seeded.pairId, windowId, force: true }, { repo, rpc: fakeRpc(), ctx: fakeCtx() });
    const second = (await selectVerifications()).map((r) => ({ ...r, verifiedAt: null }));

    expect(second).toEqual(first);
  });

  it("kasowanie okazji kasuje jej weryfikację kaskadowo (ON DELETE CASCADE, migracja 0004)", async () => {
    const repo = createDrizzleVerifyRepo(db);
    await runVerifyPairWindow({ pairId: seeded.pairId, windowId }, { repo, rpc: fakeRpc(), ctx: fakeCtx() });
    const [opp100] = await db.select().from(schema.opportunities).where(eq(schema.opportunities.block, 100));
    await db.delete(schema.opportunities).where(eq(schema.opportunities.id, opp100!.id));
    const remaining = await db.select().from(schema.opportunityVerifications).where(eq(schema.opportunityVerifications.opportunityId, opp100!.id));
    expect(remaining).toHaveLength(0);
  });
});
