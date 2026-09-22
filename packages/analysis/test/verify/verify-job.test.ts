// Test jednostkowy `runVerifyPairWindow` z fake repo/rpc — bez bazy (test
// integracyjny na realnym Postgresie jest w verify-job.integration.test.ts). Kontrakt
// `VerifyRepo`/`RpcLike` i `JobContext` (fraction 0..1, nie procent) — patrz
// `@dex-arb/shared` jobs.ts i `packages/analysis/src/analyzePairWindow.ts` (ten sam wzorzec
// progress/log/signal co `analyze:pair-window`).
import { describe, expect, it, vi } from 'vitest';
import type { JobContext } from '@dex-arb/shared';
import { runVerifyPairWindow } from '../../src/verify/verify-job';
import type { VerifyRepo } from '../../src/verify/verify-job';
import type { RpcLike, RpcRequest } from '../../src/verify/receipt';
import { CTX, USDC, buyWeth, sellWeth } from './fixtures';
import type { PairMeta, PoolMeta, VerificationResult } from '../../src/verify/types';

const TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const BOT_ADDR = '0x' + 'bot'.padStart(40, '0');
const rawReceipt = (hash: string) => ({
  transactionHash: hash,
  from: '0xbot',
  gasUsed: '0x30d40',
  effectiveGasPrice: '0x174876e800',
  status: '0x1',
  logs: [{ address: USDC, topics: [TOPIC, '0x' + '1'.padStart(64, '0'), '0x' + 'bot'.padStart(64, '0')], data: '0x' + (100_000000n).toString(16).padStart(64, '0') }],
});

function fakeRepo(): VerifyRepo & { saved: VerificationResult[] } {
  const saved: VerificationResult[] = [];
  return {
    saved,
    // WETH/USDC (fixtures.PAIR): quote-stablecoin, base=WETH -> ścieżka `ethUsd`=własna
    // `price_a` (patrz komentarz modułu w verify-job.ts).
    // `loadRefEthUsd` nie powinno być wołane na tej ścieżce (quoteSymbol !== "WETH").
    loadPairContext: async () => ({ ctx: CTX, baseSymbol: 'WETH', quoteSymbol: 'USDC' }),
    loadRefEthUsd: async () => {
      throw new Error('loadRefEthUsd nie powinno być wołane dla pary kwotowanej w stablecoinie');
    },
    listOpportunities: async (_pairId, _windowId, skipVerified) =>
      [
        { id: 1, block: 100, spreadPct: 1.0, expensivePoolId: 2 },
        { id: 2, block: 200, spreadPct: 0.9, expensivePoolId: 2 },
        { id: 3, block: 300, spreadPct: 0.8, expensivePoolId: 2 },
      ].filter((o) => !skipVerified || o.id !== 3),
    loadSwaps: async (_poolIds, from, to) =>
      [
        buyWeth({ poolId: 1, block: 101, txHash: '0xaa', to: BOT_ADDR }),
        sellWeth({ poolId: 2, block: 101, txHash: '0xaa', to: BOT_ADDR }),
        sellWeth({ poolId: 2, block: 201, txHash: '0xpp' }),
      ].filter((s) => s.block >= from && s.block <= to),
    loadSpreads: async () =>
      new Map([
        [100, { spreadPct: 1.0, priceA: 3000, priceB: 3030 }],
        [101, { spreadPct: 0.1, priceA: 3000, priceB: 3003 }],
        [200, { spreadPct: 0.9, priceA: 3000, priceB: 3027 }],
        [201, { spreadPct: 0.2, priceA: 3000, priceB: 3006 }],
        [300, { spreadPct: 0.8, priceA: 3000, priceB: 3024 }],
      ]),
    upsertVerifications: async (rs) => {
      saved.push(...rs);
    },
  };
}

function fakeRpc(): RpcLike & { batch: ReturnType<typeof vi.fn> } {
  return { batch: vi.fn(async (reqs: RpcRequest[]) => reqs.map((r) => rawReceipt(r.params[0] as string))) };
}

function fakeCtx(signal = new AbortController().signal): JobContext & { log: ReturnType<typeof vi.fn>; progress: ReturnType<typeof vi.fn> } {
  return { jobId: 1, log: vi.fn(async () => {}), progress: vi.fn(async () => {}), signal };
}

describe('runVerifyPairWindow', () => {
  it('klasyfikuje okazje, pobiera receipty tylko dla kandydatów atomowych (deduplikacja hashy), raportuje progress jako ułamek', async () => {
    const repo = fakeRepo();
    const rpc = fakeRpc();
    const ctx = fakeCtx();
    const summary = await runVerifyPairWindow({ pairId: 1, windowId: 1 }, { repo, rpc, ctx });

    expect(rpc.batch).toHaveBeenCalledTimes(1);
    expect(rpc.batch.mock.calls[0]![0]).toHaveLength(1); // jedna unikalna tx (0xaa) mimo 2 swapów w niej
    expect(summary.total).toBe(2); // id=3 pominięte (już zweryfikowane, skipVerified domyślnie)
    expect(summary.byStatus).toMatchObject({ consumed_atomic: 1, consumed_partial: 1, decayed: 0, persisted: 0 });
    // ADR 0003: `rawReceipt` fixture ma tylko Transfer USDC (żaden Swap V2/V3 spoza
    // puli, żaden token spoza pary) -> route='two_pool', zachowanie NIEZMIENIONE.
    expect(summary.byRoute).toEqual({ two_pool: 1, multi: 0 });

    const atomic = repo.saved.find((r) => r.opportunityId === 1)!;
    expect(atomic.status).toBe('consumed_atomic');
    expect(atomic.consumerTxHash).toBe('0xaa');
    expect(atomic.realizedProfitUsd).toBeCloseTo(100, 6);
    expect(atomic.route).toBe('two_pool');

    const partial = repo.saved.find((r) => r.opportunityId === 2)!;
    expect(partial.status).toBe('consumed_partial');
    expect(partial.consumerTxHash).toBe('0xpp');

    expect(ctx.progress).toHaveBeenLastCalledWith(1);
    expect(ctx.log).toHaveBeenCalled();
  });

  it('force=true reweryfikuje wszystkie okazje (nie pomija już zweryfikowanych)', async () => {
    const repo = fakeRepo();
    const summary = await runVerifyPairWindow({ pairId: 1, windowId: 1, force: true }, { repo, rpc: fakeRpc(), ctx: fakeCtx() });
    expect(summary.total).toBe(3);
    expect(summary.byStatus.persisted).toBe(1); // id=3: spread znany tylko w B (0,8 %), poza tym brak danych => nigdy nie spada poniżej progu
  });

  it('idempotencja: dwa przebiegi dają identyczne wiersze', async () => {
    const repo = fakeRepo();
    const run = () => runVerifyPairWindow({ pairId: 1, windowId: 1, force: true }, { repo, rpc: fakeRpc(), ctx: fakeCtx() });
    await run();
    const first = [...repo.saved];
    repo.saved.length = 0;
    await run();
    expect(repo.saved).toEqual(first);
  });

  it('brak receiptu (RPC zwraca null) propaguje błąd — job dostanie standardowy retry przez runnera', async () => {
    const repo = fakeRepo();
    const rpc: RpcLike = { batch: vi.fn(async (reqs: RpcRequest[]) => reqs.map(() => null)) };
    await expect(runVerifyPairWindow({ pairId: 1, windowId: 1 }, { repo, rpc, ctx: fakeCtx() })).rejects.toThrow();
  });

  it('sygnał przerwania (abort) przerywa przed przetworzeniem paczki', async () => {
    const repo = fakeRepo();
    const controller = new AbortController();
    controller.abort();
    await expect(
      runVerifyPairWindow({ pairId: 1, windowId: 1 }, { repo, rpc: fakeRpc(), ctx: fakeCtx(controller.signal) }),
    ).rejects.toThrow(/Przerwano/);
  });
});

// `verify-job.ts` zakładał `quoteUsd=1`/
// `ethUsd`=własna `price_a` dla KAŻDEJ pary — poprawne tylko dla quote-stablecoina. Poniższe
// testy pokrywają parę kwotowaną w WETH (WBTC/WETH, 8/18 dec.), gdzie `price_a` jest w skali
// WETH/WBTC (NIE ETH/USD) i wymaga referencji z już przeanalizowanej pary WETH/USDC tego okna
// (`repo.loadRefEthUsd`, reużywa `loadRefEthUsd` z `analyzePairWindow.ts`).
describe('runVerifyPairWindow — para kwotowana w WETH (WBTC/WETH)', () => {
  const WBTC = '0x' + 'bc'.repeat(20);
  const WETH2 = '0x' + 'e7'.repeat(20);
  const UNI2_ADDR = '0x' + '11'.repeat(20);
  const SUSHI2_ADDR = '0x' + '22'.repeat(20);
  const BOT2 = '0x' + 'b0'.repeat(20);
  const PAIR2: PairMeta = { id: 2, tokenBase: WBTC, tokenQuote: WETH2, baseDecimals: 8, quoteDecimals: 18 };
  const POOLS2: [PoolMeta, PoolMeta] = [
    { id: 10, address: UNI2_ADDR, token0: WBTC, token1: WETH2, dexName: 'uniswap' },
    { id: 20, address: SUSHI2_ADDR, token0: WBTC, token1: WETH2, dexName: 'sushiswap' },
  ];
  const CTX2 = { pools: POOLS2, pair: PAIR2 };
  const TOPIC2 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  // 100 000 jednostek WBTC (8 dec.) = 0,001 WBTC przekazane na BOT2 — jedyny przepływ tokenu
  // pary w tej tx (netQuote=0), więc realizedProfitUsd zależy WYŁĄCZNIE od poprawnego baseUsd.
  const WBTC_NET = 100_000n;
  const rawReceiptWbtc = (hash: string) => ({
    transactionHash: hash,
    from: BOT2,
    gasUsed: '0x30d40', // 200 000
    effectiveGasPrice: '0x174876e800', // 100 gwei
    status: '0x1',
    logs: [
      { address: WBTC, topics: [TOPIC2, '0x' + '1'.padStart(64, '0'), '0x' + BOT2.slice(2).padStart(64, '0')], data: '0x' + WBTC_NET.toString(16).padStart(64, '0') },
    ],
  });

  function fakeRepo2(refEthUsd: ((windowId: number) => Promise<(block: number) => number>) | null): VerifyRepo & { saved: VerificationResult[] } {
    const saved: VerificationResult[] = [];
    return {
      saved,
      loadPairContext: async () => ({ ctx: CTX2, baseSymbol: 'WBTC', quoteSymbol: 'WETH' }),
      loadRefEthUsd: refEthUsd ?? (async () => async () => 3000),
      listOpportunities: async () => [{ id: 1, block: 500, spreadPct: 1.0, expensivePoolId: 20 }],
      loadSwaps: async () => [
        buyWeth({ poolId: 10, block: 501, txHash: '0xwbtc', to: BOT2 }),
        sellWeth({ poolId: 20, block: 501, txHash: '0xwbtc', to: BOT2 }),
      ],
      loadSpreads: async () => new Map([[501, { spreadPct: 0.1, priceA: 15, priceB: 15.05 }]]),
      upsertVerifications: async (rs) => {
        saved.push(...rs);
      },
    };
  }

  it('baseUsd = price_a (WETH/WBTC) × kurs referencyjny ETH/USD, ethUsd = referencja — nie 1/price_a jak dla stablecoina', async () => {
    const repo = fakeRepo2(async (windowId) => {
      expect(windowId).toBe(7);
      return (_block) => 3000; // kurs referencyjny WETH/USDC tego okna
    });
    const rpc: RpcLike = { batch: vi.fn(async (reqs: RpcRequest[]) => reqs.map((r) => rawReceiptWbtc(r.params[0] as string))) };
    const summary = await runVerifyPairWindow({ pairId: 2, windowId: 7 }, { repo, rpc, ctx: fakeCtx() });

    expect(summary.byStatus.consumed_atomic).toBe(1);
    const atomic = repo.saved.find((r) => r.opportunityId === 1)!;
    expect(atomic.status).toBe('consumed_atomic');
    // baseUsd = 15 (price_a WETH/WBTC @ blok 501) × 3000 (referencja ETH/USD) = 45 000 USD/WBTC;
    // 0,001 WBTC × 45 000 = 45 USD. Ze starą logiką (quoteUsd=1, baseUsd=ethUsd=avg(price_a,
    // price_b)≈15,025) wyszłoby ≈0,015 USD — o ~3 rzędy wielkości za mało.
    expect(atomic.realizedProfitUsd).toBeCloseTo(45, 6);
    // gasCostUsd = 200 000 gas × 100 gwei / 1e18 × 3000 USD/ETH = 0,02 ETH × 3000 = 60 USD.
    expect(atomic.gasCostUsd).toBeCloseTo(60, 6);
  });

  it('brak przeanalizowanej pary referencyjnej WETH/USDC w tym oknie -> rzuca (propagowane z loadRefEthUsd)', async () => {
    const repo = fakeRepo2(async () => {
      throw new Error('Najpierw przeanalizuj WETH/USDC w tym oknie (kurs ETH/USD)');
    });
    const rpc: RpcLike = { batch: vi.fn(async (reqs: RpcRequest[]) => reqs.map((r) => rawReceiptWbtc(r.params[0] as string))) };
    await expect(runVerifyPairWindow({ pairId: 2, windowId: 7 }, { repo, rpc, ctx: fakeCtx() })).rejects.toThrow(/WETH\/USDC/);
  });
});

describe('runVerifyPairWindow — paczki (BATCH = 200)', () => {
  // 201 okazji w blokach 1000..1200; każda ma atomową tx w bloku B+1 -> 201 unikalnych hashy w 2 paczkach (200 + 1)
  function bigRepo(verifiedIds: Set<number>): VerifyRepo & { saved: VerificationResult[] } {
    const saved: VerificationResult[] = [];
    const opps = Array.from({ length: 201 }, (_, i) => ({ id: i + 1, block: 1000 + i, spreadPct: 1.0, expensivePoolId: 2 }));
    return {
      saved,
      loadPairContext: async () => ({ ctx: CTX, baseSymbol: 'WETH', quoteSymbol: 'USDC' }),
      loadRefEthUsd: async () => { throw new Error('nie dotyczy'); },
      listOpportunities: async (_p, _w, skipVerified) => opps.filter((o) => !skipVerified || !verifiedIds.has(o.id)),
      loadSwaps: async (_pools, from, to) =>
        opps.flatMap((o) => [buyWeth({ poolId: 1, block: o.block + 1, txHash: `0xtx${o.id}`, to: BOT_ADDR }), sellWeth({ poolId: 2, block: o.block + 1, txHash: `0xtx${o.id}`, to: BOT_ADDR })]).filter((s) => s.block >= from && s.block <= to),
      loadSpreads: async (_p, from, to) => new Map(Array.from({ length: to - from + 1 }, (_, k) => [from + k, { spreadPct: 1.0, priceA: 3000, priceB: 3030 }])),
      upsertVerifications: async (rs) => { saved.push(...rs); },
    };
  }

  it('awaria fetchReceipts w 2. paczce: 1. paczka (200) zapisana, job rzuca; ponowny bieg bez force dokańcza tylko resztę', async () => {
    const verified = new Set<number>();
    const repo = bigRepo(verified);
    let calls = 0;
    const rpc: RpcLike = { batch: vi.fn(async (reqs: RpcRequest[]) => { calls++; if (calls > 10) throw new Error('RPC padł'); return reqs.map((r) => rawReceipt(r.params[0] as string)); }) };
    // 200 hashy / RECEIPT_CHUNK 20 = 10 wywołań batch w 1. paczce; 11. (2. paczka) pada
    await expect(runVerifyPairWindow({ pairId: 1, windowId: 1 }, { repo, rpc, ctx: fakeCtx(), concurrency: 1 })).rejects.toThrow(/RPC padł/);
    expect(repo.saved).toHaveLength(200);
    expect(repo.saved.every((r) => r.status === 'consumed_atomic')).toBe(true);

    for (const r of repo.saved) verified.add(r.opportunityId);
    const ok: RpcLike = { batch: vi.fn(async (reqs: RpcRequest[]) => reqs.map((r) => rawReceipt(r.params[0] as string))) };
    const summary = await runVerifyPairWindow({ pairId: 1, windowId: 1 }, { repo, rpc: ok, ctx: fakeCtx(), concurrency: 1 });
    expect(summary.total).toBe(1);
    expect(repo.saved).toHaveLength(201);
    expect(repo.saved.at(-1)!.opportunityId).toBe(201);
  });
});

describe('runVerifyPairWindow — jedna tx konsumuje kilka sąsiednich okazji', () => {
  it('okazje z bloków 100, 101, 102 i atomowa tx w bloku 102: wspólny consumer_tx_hash, blocks_to_consumption 2/1/0', async () => {
    const saved: VerificationResult[] = [];
    const repo: VerifyRepo = {
      loadPairContext: async () => ({ ctx: CTX, baseSymbol: 'WETH', quoteSymbol: 'USDC' }),
      loadRefEthUsd: async () => { throw new Error('nie dotyczy'); },
      listOpportunities: async () => [100, 101, 102].map((b, i) => ({ id: i + 1, block: b, spreadPct: 1.0, expensivePoolId: 2 })),
      loadSwaps: async () => [buyWeth({ poolId: 1, block: 102, txHash: '0xshared', to: BOT_ADDR }), sellWeth({ poolId: 2, block: 102, txHash: '0xshared', to: BOT_ADDR })],
      loadSpreads: async () => new Map([100, 101, 102, 103, 104, 105].map((b) => [b, { spreadPct: b < 102 ? 1.0 : 0.1, priceA: 3000, priceB: 3030 }])),
      upsertVerifications: async (rs) => { saved.push(...rs); },
    };
    const rpc = fakeRpc();
    await runVerifyPairWindow({ pairId: 1, windowId: 1 }, { repo, rpc, ctx: fakeCtx() });
    expect(rpc.batch).toHaveBeenCalledTimes(1);
    expect(rpc.batch.mock.calls[0]![0]).toHaveLength(1); // jeden receipt dla trzech okazji
    expect(saved.map((r) => [r.status, r.consumerTxHash, r.blocksToConsumption])).toEqual([
      ['consumed_atomic', '0xshared', 2],
      ['consumed_atomic', '0xshared', 1],
      ['consumed_atomic', '0xshared', 0],
    ]);
  });
});

describe('runVerifyPairWindow — walidacja quote-stablecoin/base-WETH', () => {
  it('para kwotowana w stablecoinie, ale token bazowy NIE jest WETH -> rzuca (price_a nie byłby kursem ETH/USD)', async () => {
    const repo: VerifyRepo = {
      loadPairContext: async () => ({ ctx: CTX, baseSymbol: 'USDC', quoteSymbol: 'USDT' }),
      loadRefEthUsd: async () => {
        throw new Error('nie powinno być wołane');
      },
      listOpportunities: async () => [],
      loadSwaps: async () => [],
      loadSpreads: async () => new Map(),
      upsertVerifications: async () => {},
    };
    await expect(runVerifyPairWindow({ pairId: 3, windowId: 1 }, { repo, rpc: fakeRpc(), ctx: fakeCtx() })).rejects.toThrow(/nie WETH/);
  });
});
