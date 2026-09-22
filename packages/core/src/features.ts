/**
 * Cechy wejściowe FIS — definicje identyczne z implementacją referencyjną (
 * src/analyze-data.ts):
 *  S — spread [%] (max 3), G — koszt gazu arbitrażu wzgl. 50 000 USD [%] (max 2),
 *  L — TVL płytszej puli [mln USD] (max 100),
 *  M — 100·(0,5·percentyl(swapów w bloku) + 0,5·percentyl(ceny gazu)), percentyle w oknie.
 * Obcięcia do dziedzin FIS (S≤3, G≤2, L≤100, M∈[0,100]) żyją WYŁĄCZNIE tutaj
 * (ustalenie z przeglądu projektowego) — dalsze warstwy (Mamdani, baseline) dostają
 * już obcięte wartości.
 */
import { ARB_GAS, G_MAX, L_MAX, REF_TRADE_USD, S_MAX } from "./constants.js";
export { ARB_GAS, G_MAX, L_MAX, REF_TRADE_USD, S_MAX };

/** Rozbieżność cenowa względem tańszej puli [%]: |pA − pB| / min(pA, pB) · 100. */
export function spreadPct(priceA: number, priceB: number): number {
  return (Math.abs(priceA - priceB) / Math.min(priceA, priceB)) * 100;
}

/** Koszt gazu arbitrażu (220k gazu) w USD, przy zadanej cenie gazu [gwei] i cenie ETH [USD]. */
export function gasCostUsd(gasPriceGwei: number, ethUsd: number): number {
  return ARB_GAS * gasPriceGwei * 1e-9 * ethUsd;
}

/** Udział elementów ≤ x w posortowanej tablicy (bisekcja górna) — jak percentileRank w evaluate.ts. */
export function percentileRank(sorted: number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

/** Interpolacja liniowa po rosnących xs; poza zakresem wartość skrajna — jak gasAt w evaluate.ts. */
export function interpolateLinear(xs: number[], ys: number[], x: number): number {
  if (xs.length === 0) throw new Error("interpolateLinear: brak próbek");
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[xs.length - 1]!) return ys[ys.length - 1]!;
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) lo = mid;
    else hi = mid;
  }
  return ys[lo]! + ((ys[hi]! - ys[lo]!) * (x - xs[lo]!)) / (xs[hi]! - xs[lo]!);
}

export interface FeatureInputs {
  spreadPct: number;
  tvlMinUsd: number;
  gasPriceGwei: number;
  /** cena ETH z puli Uniswap (referencyjna dla przeliczenia gazu na USD, jak w evaluate.ts). */
  ethUsd: number;
  /** liczba Swapów obu puli w bloku. */
  swapsInBlock: number;
}

export interface WindowPercentiles {
  /** liczby swapów w bloku, po wszystkich blokach okna, posortowane rosnąco. */
  sortedSwapCounts: number[];
  /** cena gazu [gwei] interpolowana dla każdego bloku okna, posortowana rosnąco. */
  sortedGasGwei: number[];
}

/** Cechy S/G/L/M dla jednego bloku, z obcięciem do dziedzin FIS. */
export function computeRawFeatures(
  i: FeatureInputs,
  p: WindowPercentiles,
): { S: number; G: number; L: number; M: number } {
  const S = Math.min(i.spreadPct, S_MAX);
  const G = Math.min((gasCostUsd(i.gasPriceGwei, i.ethUsd) / REF_TRADE_USD) * 100, G_MAX);
  const L = Math.min(i.tvlMinUsd / 1e6, L_MAX);
  const M =
    100 *
    (0.5 * percentileRank(p.sortedSwapCounts, i.swapsInBlock) +
      0.5 * percentileRank(p.sortedGasGwei, i.gasPriceGwei));
  return { S, G, L, M };
}
