/** Matematyka puli x·y=k (Uniswap V2 / Sushiswap) na bigint. */

/** Cena tokena bazowego w jednostkach tokena kwotowanego (np. USDC za 1 WETH). */
export function priceFromReserves(
  reserveBase: bigint,
  decBase: number,
  reserveQuote: bigint,
  decQuote: number,
): number {
  if (reserveBase === 0n) throw new Error("reserveBase = 0");
  return Number(reserveQuote) / 10 ** decQuote / (Number(reserveBase) / 10 ** decBase);
}

/**
 * Uniswap V2 `UniswapV2Library.getAmountOut` — arytmetyka całkowita jak w kontrakcie
 * (γ = (10000 - feeBps)/10000, zaokrąglenie w dół tak jak dzielenie całkowite Solidity).
 */
export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps = 30): bigint {
  if (reserveIn <= 0n || reserveOut <= 0n) throw new Error("pusta pula");
  if (amountIn <= 0n) return 0n;
  const feeNum = BigInt(10_000 - feeBps);
  const amountInWithFee = amountIn * feeNum;
  return (amountInWithFee * reserveOut) / (reserveIn * 10_000n + amountInWithFee);
}

/**
 * Całkowity pierwiastek kwadratowy (metoda Newtona), ⌊√n⌋ — bez błędu zaokrąglenia float.
 * Przypadki brzegowe n ∈ {1,2,3} wydzielone osobno (jak `Math.sol` Uniswapa): dla nich
 * początkowe przybliżenie x = n/2+1 jest ≥ n, więc pętla Newtona w ogóle by się nie
 * wykonała i funkcja zwróciłaby błędnie x zamiast 1 (np. isqrt(2n) dawało 2n zamiast 1n).
 */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("isqrt: n < 0");
  if (n <= 3n) return n > 0n ? 1n : 0n;
  let z = n;
  let x = n / 2n + 1n;
  while (x < z) {
    z = x;
    x = (n / x + x) / 2n;
  }
  return z;
}

/** Rezerwy puli w jednostkach natywnych (wei / 10⁻⁶ USDC), już przemapowane token0/token1 -> base/quote. */
export interface PoolReserves {
  base: bigint;
  quote: bigint;
}

/**
 * Optymalna wpłata Δy (w quote) do puli `a` (kupno base), by natychmiast sprzedać base w puli `b`.
 * Wyprowadzenie (maksimum zysku przy γ = (10000-feeBps)/10000, tzw. "AMM cross-pool arbitrage"):
 *   Δy* = (γ·√(Xa·Ya·Xb·Yb) − Xb·Ya) / (γ·(Xb + γ·Xa))
 * W arytmetyce całkowitej ze skalą F = 10000 − feeBps (γ = F/10000), po pomnożeniu licznika
 * i mianownika przez 10000, tak by pod pierwiastkiem zostały tylko iloczyny bigintów:
 *   Δy* = 10000·(F·√(Xa·Ya·Xb·Yb) − 10000·Xb·Ya) / (F·(10000·Xb + F·Xa))
 * `0n`, gdy licznik <= 0 (spread nie pokrywa dwóch prowizji, albo zły kierunek — base w `a`
 * nie jest tańszy niż w `b`, więc arbitraż w tę stronę nie ma sensu).
 */
export function optimalTradeIn(a: PoolReserves, b: PoolReserves, feeBps = 30): bigint {
  const F = BigInt(10_000 - feeBps);
  const Xa = a.base, Ya = a.quote, Xb = b.base, Yb = b.quote;
  const num = F * isqrt(Xa * Ya * Xb * Yb) - 10_000n * Xb * Ya;
  if (num <= 0n) return 0n;
  const den = F * (10_000n * Xb + F * Xa);
  return (10_000n * num) / den;
}

/** Zysk brutto dwóch swapów (quote→base w `a`, base→quote w `b`) — dokładna arytmetyka kontraktu. */
export function grossProfit(
  a: PoolReserves,
  b: PoolReserves,
  amountIn: bigint,
  feeBps = 30,
): { amountBase: bigint; amountOut: bigint; profit: bigint } {
  const amountBase = getAmountOut(amountIn, a.quote, a.base, feeBps);
  const amountOut = getAmountOut(amountBase, b.base, b.quote, feeBps);
  return { amountBase, amountOut, profit: amountOut - amountIn };
}

export interface ArbitrageResult {
  direction: "a->b" | "b->a" | "none";
  /** Δy* w jednostkach quote */
  tradeIn: bigint;
  /** zysk brutto w jednostkach quote */
  profit: bigint;
}

/** Arbitraż między dwiema pulami tej samej pary; kierunek (która pula tańsza) dobierany z cen. */
export function arbitrage(poolA: PoolReserves, poolB: PoolReserves, feeBps = 30): ArbitrageResult {
  // base tańszy tam, gdzie quote/base mniejsze: Ya/Xa < Yb/Xb  <=>  Ya·Xb < Yb·Xa
  // (mnożenie krzyżowe zamiast dzielenia — bez utraty precyzji na bigincie)
  const aCheaper = poolA.quote * poolB.base < poolB.quote * poolA.base;
  const [buy, sell, direction] = aCheaper ? [poolA, poolB, "a->b" as const] : [poolB, poolA, "b->a" as const];
  const tradeIn = optimalTradeIn(buy, sell, feeBps);
  if (tradeIn <= 0n) return { direction: "none", tradeIn: 0n, profit: 0n };
  const { profit } = grossProfit(buy, sell, tradeIn, feeBps);
  if (profit <= 0n) return { direction: "none", tradeIn: 0n, profit: 0n };
  return { direction, tradeIn, profit };
}
