import { describe, it, expect } from 'vitest';
import { findAtomicCandidates, findPartialConsumer, groupByTx } from '../../src/verify/detect';
import { CTX, buyWeth, sellWeth, swap } from './fixtures';

describe('groupByTx', () => {
  it('groups swaps by txHash preserving log order', () => {
    const g = groupByTx([swap({ txHash: '0x1', logIndex: 5 }), swap({ txHash: '0x1', logIndex: 2 }), swap({ txHash: '0x2' })]);
    expect([...g.keys()]).toEqual(['0x1', '0x2']);
    expect(g.get('0x1')!.map((s) => s.logIndex)).toEqual([2, 5]);
  });
});

describe('findAtomicCandidates', () => {
  it('detects buy on uni + sell on sushi in the same tx', () => {
    const swaps = [buyWeth({ poolId: 1, txHash: '0xaa' }), sellWeth({ poolId: 2, txHash: '0xaa' })];
    const c = findAtomicCandidates(swaps, CTX);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ txHash: '0xaa', buyPoolId: 1, sellPoolId: 2, beneficiary: '0xbot' });
  });
  it('ignores same direction in both pools (not arbitrage)', () => {
    const swaps = [buyWeth({ poolId: 1, txHash: '0xaa' }), buyWeth({ poolId: 2, txHash: '0xaa' })];
    expect(findAtomicCandidates(swaps, CTX)).toHaveLength(0);
  });
  it('ignores tx touching only one pool', () => {
    expect(findAtomicCandidates([buyWeth({ poolId: 1 }), sellWeth({ poolId: 1 })], CTX)).toHaveLength(0);
  });
  it('ignores AMBIGUOUS swaps', () => {
    const amb = swap({ poolId: 2, txHash: '0xaa', amount0In: 1n, amount1In: 1n, amount0Out: 1n });
    expect(findAtomicCandidates([buyWeth({ poolId: 1, txHash: '0xaa' }), amb], CTX)).toHaveLength(0);
  });
  it('beneficiary is null when `to` differs between swaps', () => {
    const swaps = [buyWeth({ poolId: 1, to: '0xsushipool' }), sellWeth({ poolId: 2, to: '0xbot' })];
    expect(findAtomicCandidates(swaps, CTX)[0].beneficiary).toBeNull();
  });
  it('sorts candidates by block then logIndex', () => {
    const swaps = [
      buyWeth({ poolId: 1, txHash: '0xb', block: 102, logIndex: 1 }), sellWeth({ poolId: 2, txHash: '0xb', block: 102, logIndex: 2 }),
      buyWeth({ poolId: 1, txHash: '0xa', block: 101, logIndex: 9 }), sellWeth({ poolId: 2, txHash: '0xa', block: 101, logIndex: 10 }),
    ];
    expect(findAtomicCandidates(swaps, CTX).map((c) => c.txHash)).toEqual(['0xa', '0xb']);
  });
  it('handles two opposite-direction swaps in the same pool within one tx (uses first by logIndex for direction)', () => {
    const swaps = [
      buyWeth({ poolId: 1, txHash: '0xaa', logIndex: 5 }),
      sellWeth({ poolId: 1, txHash: '0xaa', logIndex: 9 }),
      sellWeth({ poolId: 2, txHash: '0xaa', logIndex: 3 }),
    ];
    const c = findAtomicCandidates(swaps, CTX);
    expect(c).toHaveLength(1);
    // pool 1's first swap by logIndex (5, buyWeth => BUY_BASE) is used, not the later
    // sellWeth at logIndex 9 — if the later one were used both pools would read SELL_BASE
    // and no candidate would be found.
    expect(c[0]).toMatchObject({ buyPoolId: 1, sellPoolId: 2 });
  });
});

describe('findPartialConsumer', () => {
  it('returns sell on expensive pool', () => {
    const s = sellWeth({ poolId: 2, txHash: '0xcc' });
    expect(findPartialConsumer([buyWeth({ poolId: 2 }), s], CTX, 2)).toBe(s);
  });
  it('returns buy on cheap pool', () => {
    const s = buyWeth({ poolId: 1, txHash: '0xcc' });
    expect(findPartialConsumer([s], CTX, 2)).toBe(s);
  });
  it('returns null when only spread-widening swaps', () => {
    expect(findPartialConsumer([buyWeth({ poolId: 2 }), sellWeth({ poolId: 1 })], CTX, 2)).toBeNull();
  });
});
