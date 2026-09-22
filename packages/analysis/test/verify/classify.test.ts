import { describe, it, expect } from 'vitest';
import { classify, pickCandidate, K_MAX } from '../../src/verify/classify';
import type { ClassifyInput } from '../../src/verify/classify';
import { TOPIC_SWAP_V2, TOPIC_SWAP_V3 } from '../../src/verify/route';
import { CTX, SUSHI_POOL_ADDR, UNI_POOL_ADDR, USDC, buyWeth, sellWeth } from './fixtures';
import type { Receipt } from '../../src/verify/types';

const BOT = '0xbot';
const opp = { id: 7, block: 100, spreadPct: 1.2, expensivePoolId: 2 };
const spreads = (m: Record<number, number>) => (b: number) => {
  const ks = Object.keys(m).map(Number).filter((k) => k <= b).sort((a, c) => c - a);
  return ks.length ? m[ks[0]] : 0;
};
const base = (o: Partial<ClassifyInput>): ClassifyInput => ({ opp, swaps: [], spreadAt: spreads({ 100: 1.2 }), thresholdPct: 0.65, ctx: CTX, ...o });
const receipt: Receipt = {
  txHash: '0xaa', from: BOT, to: '0xrouter', gasUsed: 200_000n, effectiveGasPrice: 100n * 10n ** 9n, status: 1,
  transfers: [{ address: USDC, from: '0xsushi', to: BOT, value: 100_000000n }],
};
const price = { baseUsd: 3000, quoteUsd: 1 };

describe('pickCandidate', () => {
  it('returns first atomic tx within B..B+K_MAX', () => {
    const swaps = [
      buyWeth({ poolId: 1, txHash: '0xlate', block: 102 }), sellWeth({ poolId: 2, txHash: '0xlate', block: 102 }),
      buyWeth({ poolId: 1, txHash: '0xaa', block: 101 }), sellWeth({ poolId: 2, txHash: '0xaa', block: 101 }),
    ];
    expect(pickCandidate(base({ swaps }))!.txHash).toBe('0xaa');
  });
  it('ignores tx after B+K_MAX', () => {
    const b = 100 + K_MAX + 1;
    const swaps = [buyWeth({ poolId: 1, block: b }), sellWeth({ poolId: 2, block: b })];
    expect(pickCandidate(base({ swaps }))).toBeNull();
  });
  it('finds an atomic tx at the inclusive boundary B+K_MAX', () => {
    const b = 100 + K_MAX;
    const swaps = [buyWeth({ poolId: 1, block: b }), sellWeth({ poolId: 2, block: b })];
    expect(pickCandidate(base({ swaps }))?.block).toBe(b);
  });
});

describe('classify', () => {
  it('consumed_atomic with realized profit and profitable_consumed=true', () => {
    const swaps = [buyWeth({ poolId: 1, block: 101, to: BOT }), sellWeth({ poolId: 2, block: 101, to: BOT })];
    const input = base({ swaps });
    const r = classify(input, pickCandidate(input), receipt, price, 3000);
    expect(r).toMatchObject({ opportunityId: 7, status: 'consumed_atomic', consumerTxHash: '0xaa', blocksToConsumption: 1, gasUsed: 200_000n });
    expect(r.realizedProfitUsd).toBeCloseTo(100, 6);
    expect(r.gasCostUsd).toBeCloseTo(60, 6);
    expect(r.profitableConsumed).toBe(true);
    // `receipt` (fixture powyżej) nie ma pola `nativeLeg` (Receipt budowany ręcznie, jak
    // wszystkie fixture'y w tym pliku) -> `classify` używa `?? false`.
    expect(r.nativeLeg).toBe(false);
  });
  it('consumed_atomic but unprofitable => profitable_consumed=false', () => {
    const swaps = [buyWeth({ poolId: 1, block: 100, to: BOT }), sellWeth({ poolId: 2, block: 100, to: BOT })];
    const input = base({ swaps });
    const r = classify(input, pickCandidate(input), { ...receipt, transfers: [] }, price, 3000);
    expect(r.status).toBe('consumed_atomic');
    expect(r.blocksToConsumption).toBe(0);
    expect(r.profitableConsumed).toBe(false);
  });
  it('uses receipt.from when beneficiary is null', () => {
    const swaps = [buyWeth({ poolId: 1, block: 100, to: '0xsushi' }), sellWeth({ poolId: 2, block: 100, to: BOT })];
    const input = base({ swaps });
    const r = classify(input, pickCandidate(input), receipt, price, 3000);
    expect(r.realizedProfitUsd).toBeCloseTo(100, 6);
  });
  it('consumed_partial: one-sided narrowing swap and spread drops below threshold', () => {
    const swaps = [sellWeth({ poolId: 2, block: 101, txHash: '0xpp' })];
    const input = base({ swaps, spreadAt: spreads({ 100: 1.2, 101: 0.3 }) });
    const r = classify(input, null, null, price, 3000);
    expect(r).toMatchObject({ status: 'consumed_partial', consumerTxHash: '0xpp', blocksToConsumption: 1, realizedProfitUsd: null, profitableConsumed: false });
  });
  it('decayed: spread drops without narrowing swap in our pools', () => {
    const input = base({ spreadAt: spreads({ 100: 1.2, 102: 0.1 }) });
    const r = classify(input, null, null, price, 3000);
    expect(r).toMatchObject({ status: 'decayed', consumerTxHash: null, blocksToConsumption: 2 });
  });
  it('persisted: spread stays above threshold through B+K_MAX', () => {
    const input = base({ spreadAt: spreads({ 100: 1.2 }) });
    const r = classify(input, null, null, price, 3000);
    expect(r).toMatchObject({ status: 'persisted', blocksToConsumption: null, profitableConsumed: false });
  });
  it('failed receipt (status 0) is not consumed_atomic — falls through to spread logic', () => {
    const swaps = [buyWeth({ poolId: 1, block: 100 }), sellWeth({ poolId: 2, block: 100 })];
    const input = base({ swaps });
    const r = classify(input, pickCandidate(input), { ...receipt, status: 0 }, price, 3000);
    expect(r.status).toBe('persisted');
  });
  it('gradual decay: narrowing swap at B+0 is ignored — only the swap in the crossing block (B+2) counts', () => {
    const swaps = [sellWeth({ poolId: 2, block: 100, txHash: '0xearly' }), sellWeth({ poolId: 2, block: 102, txHash: '0xlate' })];
    const input = base({ swaps, spreadAt: spreads({ 100: 1.2, 102: 0.3 }) });
    const r = classify(input, null, null, price, 3000);
    expect(r).toMatchObject({ status: 'consumed_partial', consumerTxHash: '0xlate', blocksToConsumption: 2 });
  });
  it('gradual decay without a swap in the crossing block => decayed, not consumed_partial', () => {
    const swaps = [sellWeth({ poolId: 2, block: 100, txHash: '0xearly' })];
    const input = base({ swaps, spreadAt: spreads({ 100: 1.2, 102: 0.3 }) });
    const r = classify(input, null, null, price, 3000);
    expect(r).toMatchObject({ status: 'decayed', consumerTxHash: null, blocksToConsumption: 2 });
  });
  it('decay at the inclusive boundary B+K_MAX (k=3) => decayed', () => {
    const input = base({ spreadAt: spreads({ 100: 1.2, 103: 0.3 }) });
    const r = classify(input, null, null, price, 3000);
    expect(r).toMatchObject({ status: 'decayed', blocksToConsumption: 3 });
  });
  it('decay only past the window (k=4, B+4) is invisible => persisted', () => {
    const input = base({ spreadAt: spreads({ 100: 1.2, 104: 0.3 }) });
    const r = classify(input, null, null, price, 3000);
    expect(r).toMatchObject({ status: 'persisted', blocksToConsumption: null });
  });
  it('atomic candidate wygrywa z decay: spread też spadł w tym samym bloku, ale liczy się atomic', () => {
    const swaps = [buyWeth({ poolId: 1, block: 101, to: BOT }), sellWeth({ poolId: 2, block: 101, to: BOT })];
    const input = base({ swaps, spreadAt: spreads({ 100: 1.2, 101: 0.1 }) });
    const r = classify(input, pickCandidate(input), receipt, price, 3000);
    expect(r.status).toBe('consumed_atomic');
    expect(r.consumerTxHash).toBe('0xaa');
    expect(r.blocksToConsumption).toBe(1);
  });

  it('profitUsd === gasCostUsd (not strictly positive) => profitableConsumed=false', () => {
    const swaps = [buyWeth({ poolId: 1, block: 100, to: BOT }), sellWeth({ poolId: 2, block: 100, to: BOT })];
    const input = base({ swaps });
    const evenReceipt: Receipt = { ...receipt, transfers: [{ address: USDC, from: '0xsushi', to: BOT, value: 60_000000n }] };
    const r = classify(input, pickCandidate(input), evenReceipt, price, 3000);
    expect(r.status).toBe('consumed_atomic');
    expect(r.realizedProfitUsd).toBeCloseTo(60, 6);
    expect(r.gasCostUsd).toBeCloseTo(60, 6);
    expect(r.profitableConsumed).toBe(false);
  });

  it('propaguje receipt.nativeLeg=true do VerificationResult.nativeLeg (ADR 0004)', () => {
    const swaps = [buyWeth({ poolId: 1, block: 100, to: BOT }), sellWeth({ poolId: 2, block: 100, to: BOT })];
    const input = base({ swaps });
    const nativeReceipt: Receipt = { ...receipt, nativeLeg: true };
    const r = classify(input, pickCandidate(input), nativeReceipt, price, 3000);
    expect(r.status).toBe('consumed_atomic');
    expect(r.nativeLeg).toBe(true);
  });

  it('statusy inne niż consumed_atomic mają nativeLeg=null (jak beneficiary/beneficiaryKind)', () => {
    const input = base({ spreadAt: spreads({ 100: 1.2 }) });
    const r = classify(input, null, null, price, 3000);
    expect(r.status).toBe('persisted');
    expect(r.nativeLeg).toBeNull();
  });

  // Trasa 'multi' (classifyRoute — uzasadnienie w nagłówku route.ts): realizedProfitUsd=null,
  // profitableConsumed=false, status wciąż consumed_atomic, gasCostUsd wyliczone.
  describe('route (route-fix)', () => {
    it("clean two-pool receipt (bez pola `logs`, jak reszta fixture'ów tego pliku) -> route='two_pool', zachowanie NIEZMIENIONE", () => {
      const swaps = [buyWeth({ poolId: 1, block: 101, to: BOT }), sellWeth({ poolId: 2, block: 101, to: BOT })];
      const input = base({ swaps });
      const r = classify(input, pickCandidate(input), receipt, price, 3000);
      expect(r.status).toBe('consumed_atomic');
      expect(r.route).toBe('two_pool');
      expect(r.realizedProfitUsd).toBeCloseTo(100, 6);
      expect(r.profitableConsumed).toBe(true);
    });

    it("multi-pool: dodatkowy Swap V2 z trzeciej puli -> route='multi', realizedProfitUsd=null, profitableConsumed=false, status wciąż consumed_atomic, gasCostUsd nadal wyliczone", () => {
      const swaps = [buyWeth({ poolId: 1, block: 101, to: BOT }), sellWeth({ poolId: 2, block: 101, to: BOT })];
      const input = base({ swaps });
      const multiReceipt: Receipt = {
        ...receipt,
        logs: [
          { address: UNI_POOL_ADDR, topic0: TOPIC_SWAP_V2 },
          { address: SUSHI_POOL_ADDR, topic0: TOPIC_SWAP_V2 },
          { address: '0x' + 'cc'.repeat(20), topic0: TOPIC_SWAP_V2 }, // trzecia pula, spoza pary
        ],
      };
      const r = classify(input, pickCandidate(input), multiReceipt, price, 3000);
      expect(r.status).toBe('consumed_atomic');
      expect(r.route).toBe('multi');
      expect(r.realizedProfitUsd).toBeNull();
      expect(r.profitableConsumed).toBe(false);
      expect(r.gasCostUsd).toBeCloseTo(60, 6); // koszt gazu wiarygodny niezależnie od trasy
      expect(r.consumerTxHash).toBe('0xaa'); // okazja BYŁA skonsumowana, tylko realny zysk nieznany
    });

    it("obcy token Transfer (spoza pary) -> route='multi'", () => {
      const swaps = [buyWeth({ poolId: 1, block: 100, to: BOT }), sellWeth({ poolId: 2, block: 100, to: BOT })];
      const input = base({ swaps });
      const foreignTokenReceipt: Receipt = {
        ...receipt,
        transfers: [...receipt.transfers, { address: '0x' + 'da1'.padStart(40, '0'), from: '0xdaipool', to: BOT, value: 500n * 10n ** 18n }],
      };
      const r = classify(input, pickCandidate(input), foreignTokenReceipt, price, 3000);
      expect(r.route).toBe('multi');
      expect(r.realizedProfitUsd).toBeNull();
      expect(r.profitableConsumed).toBe(false);
    });

    it("swap V3 -> route='multi'", () => {
      const swaps = [buyWeth({ poolId: 1, block: 100, to: BOT }), sellWeth({ poolId: 2, block: 100, to: BOT })];
      const input = base({ swaps });
      const v3Receipt: Receipt = {
        ...receipt,
        logs: [
          { address: UNI_POOL_ADDR, topic0: TOPIC_SWAP_V2 },
          { address: SUSHI_POOL_ADDR, topic0: TOPIC_SWAP_V2 },
          { address: '0x' + 'ee'.repeat(20), topic0: TOPIC_SWAP_V3 },
        ],
      };
      const r = classify(input, pickCandidate(input), v3Receipt, price, 3000);
      expect(r.route).toBe('multi');
      expect(r.realizedProfitUsd).toBeNull();
      expect(r.profitableConsumed).toBe(false);
    });

    it('statusy inne niż consumed_atomic mają route=null', () => {
      const input = base({ spreadAt: spreads({ 100: 1.2 }) });
      const r = classify(input, null, null, price, 3000);
      expect(r.status).toBe('persisted');
      expect(r.route).toBeNull();
    });
  });
});
