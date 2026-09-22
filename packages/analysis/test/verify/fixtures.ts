import type { PairMeta, PoolMeta, SwapRow } from '../../src/verify/types';

export const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
export const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
// Adresy on-chain realnych puli WETH/USDC (patrz docs/konwencje.md) — nieużywane jako `to`/beneficjent
// w żadnym istniejącym swapowym fixture (`swap`/`buyWeth`/`sellWeth` domyślnie `to: '0xbot'`),
// więc dodanie `address` nie zmienia zachowania istniejących testów.
export const UNI_POOL_ADDR = '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc';
export const SUSHI_POOL_ADDR = '0x397ff1542f962076d0bfe58ea045ffa2d347aca0';
export const UNI: PoolMeta = { id: 1, address: UNI_POOL_ADDR, token0: USDC, token1: WETH, dexName: 'uniswap' };
export const SUSHI: PoolMeta = { id: 2, address: SUSHI_POOL_ADDR, token0: USDC, token1: WETH, dexName: 'sushiswap' };
export const PAIR: PairMeta = { id: 1, tokenBase: WETH, tokenQuote: USDC, baseDecimals: 18, quoteDecimals: 6 };
export const CTX = { pools: [UNI, SUSHI] as [PoolMeta, PoolMeta], pair: PAIR };

let li = 0;
export const swap = (o: Partial<SwapRow>): SwapRow => ({
  poolId: 1, block: 100, logIndex: li++, txHash: '0xaa', sender: '0xrouter', to: '0xbot',
  amount0In: 0n, amount0Out: 0n, amount1In: 0n, amount1Out: 0n, gasPrice: 100_000_000_000n, ...o,
});
/** kup 1 WETH za 3000 USDC */
export const buyWeth = (o: Partial<SwapRow>) => swap({ amount0In: 3000_000000n, amount1Out: 10n ** 18n, ...o });
/** sprzedaj 1 WETH za 3020 USDC */
export const sellWeth = (o: Partial<SwapRow>) => swap({ amount1In: 10n ** 18n, amount0Out: 3020_000000n, ...o });
