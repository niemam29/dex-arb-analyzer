/**
 * Kierunek swapu w puli V2 (event Swap) i jego normalizacja do pary (base/quote).
 * Patrz sekcja "Definicje kluczowe" w planie etapu 4.
 */
import type { PairDirection, PairMeta, PoolMeta, RawDirection, SwapRow } from "./types.js";

export const eqAddr = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * BUY_TOKEN1 gdy wpłacono token0 i odebrano token1; BUY_TOKEN0 odwrotnie.
 * Oba amountIn > 0 (lub oba = 0, brak odpowiadającego amountOut) => AMBIGUOUS.
 * Oba amountOut > 0 (nietypowy, "podwójny" swap) => AMBIGUOUS niezależnie od amountIn.
 */
export function swapDirection(s: SwapRow): RawDirection {
  if (s.amount0Out > 0n && s.amount1Out > 0n) return 'AMBIGUOUS';
  const in0 = s.amount0In > 0n;
  const in1 = s.amount1In > 0n;
  if (in0 && !in1 && s.amount1Out > 0n) return 'BUY_TOKEN1';
  if (in1 && !in0 && s.amount0Out > 0n) return 'BUY_TOKEN0';
  return 'AMBIGUOUS';
}

/** Kierunek względem pary: BUY_BASE gdy odbierany token == token_base. */
export function toPairDirection(s: SwapRow, pool: PoolMeta, pair: PairMeta): PairDirection {
  const raw = swapDirection(s);
  if (raw === 'AMBIGUOUS') return 'AMBIGUOUS';
  const bought = raw === 'BUY_TOKEN1' ? pool.token1 : pool.token0;
  return eqAddr(bought, pair.tokenBase) ? 'BUY_BASE' : 'SELL_BASE';
}
