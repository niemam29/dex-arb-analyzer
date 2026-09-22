import { describe, it, expect } from 'vitest';
import { swapDirection, toPairDirection } from '../../src/verify/direction';
import type { SwapRow, PoolMeta, PairMeta } from '../../src/verify/types';

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const base = (o: Partial<SwapRow>): SwapRow => ({
  poolId: 1, block: 1, logIndex: 0, txHash: '0x1', sender: '0xs', to: '0xt',
  amount0In: 0n, amount0Out: 0n, amount1In: 0n, amount1Out: 0n, gasPrice: null, ...o,
});
const pool: PoolMeta = { id: 1, address: '0xpool', token0: USDC, token1: WETH, dexName: 'uniswap' };
const pair: PairMeta = { id: 1, tokenBase: WETH, tokenQuote: USDC, baseDecimals: 18, quoteDecimals: 6 };

describe('swapDirection', () => {
  it('token0 in, token1 out => BUY_TOKEN1', () => {
    expect(swapDirection(base({ amount0In: 1000n, amount1Out: 1n }))).toBe('BUY_TOKEN1');
  });
  it('token1 in, token0 out => BUY_TOKEN0', () => {
    expect(swapDirection(base({ amount1In: 1n, amount0Out: 1000n }))).toBe('BUY_TOKEN0');
  });
  it('both in => AMBIGUOUS', () => {
    expect(swapDirection(base({ amount0In: 1n, amount1In: 1n, amount0Out: 1n }))).toBe('AMBIGUOUS');
  });
  it('nothing in => AMBIGUOUS', () => {
    expect(swapDirection(base({}))).toBe('AMBIGUOUS');
  });
  it('both amountOut > 0 => AMBIGUOUS even with a single amountIn set', () => {
    expect(swapDirection(base({ amount0In: 1000n, amount0Out: 1n, amount1Out: 1n }))).toBe('AMBIGUOUS');
  });
});

describe('toPairDirection', () => {
  it('buying WETH (token1) in pool where base=WETH => BUY_BASE', () => {
    expect(toPairDirection(base({ amount0In: 1000n, amount1Out: 1n }), pool, pair)).toBe('BUY_BASE');
  });
  it('selling WETH => SELL_BASE', () => {
    expect(toPairDirection(base({ amount1In: 1n, amount0Out: 1000n }), pool, pair)).toBe('SELL_BASE');
  });
  it('pool with reversed token order flips mapping', () => {
    const flipped: PoolMeta = { id: 2, address: '0xpool2', token0: WETH, token1: USDC, dexName: 'sushiswap' };
    expect(toPairDirection(base({ amount0In: 1n, amount1Out: 1000n }), flipped, pair)).toBe('SELL_BASE');
  });
  it('address comparison is case-insensitive', () => {
    const up: PoolMeta = { ...pool, token1: WETH.toUpperCase() };
    expect(toPairDirection(base({ amount0In: 1000n, amount1Out: 1n }), up, pair)).toBe('BUY_BASE');
  });
});
