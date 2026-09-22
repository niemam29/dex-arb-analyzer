// Cechy S/G/L/M i baseline dla każdego bloku okna — funkcja czysta, bez
// dostępu do bazy: wejście to stany rezerw odtworzone przez `buildPairStates` + wejścia okna
// wczytane przez `loadPairWindowInputs`.
//
// Gaz: `blocks` w bazie ma wiersze tylko dla bloków, w których wystąpiło jakieś zdarzenie
// (Sync/Swap) — `gasPriceMedian` jest więc statystyką blokową liczoną tylko dla „bloków
// zdarzeń”. Dla pozostałych bloków okna cenę gazu wyznaczamy interpolacją liniową między
// najbliższymi próbkami (poza zakresem próbek — wartość skrajna), dokładnie tak jak stary
// Implementacja referencyjna interpolowała 250 próbek gazu (odpowiednik `gasAt`).
import { arbitrage, baselineNetProfitUsd, computeRawFeatures, interpolateLinear } from "@dex-arb/core";
import type { PairWindowInputs } from "./loadInputs.js";
import type { EthUsdFn, QuoteUsdFn } from "./quoteUsd.js";
import type { PairBlockState } from "./reserveStates.js";

export interface BlockStateRow {
  pairId: number;
  windowId: number;
  block: number;
  priceA: number;
  priceB: number;
  spreadPct: number;
  tvlMinUsd: number;
  /** mediana ceny gazu bloku [gwei], interpolowana dla bloków bez zdarzeń */
  gasPriceMedian: number;
  swapsInBlock: number;
  s: number;
  g: number;
  l: number;
  m: number;
  optTradeUsd: number;
  baselineNetProfitUsd: number;
  baselineFeasible: boolean;
  direction: "a->b" | "b->a" | "none";
  grossProfitUsd: number;
}

/**
 * Cechy S/G/L/M i baseline dla każdego bloku okna, w kolejności `states` (od pierwszego
 * bloku, w którym obie pule mają już stan, do końca okna — patrz `buildPairStates`).
 * Percentyle wchodzące w M liczone są po WSZYSTKICH blokach okna (`states`), nie tylko
 * po blokach z arbitrażem.
 */
export function computeBlockStates(
  states: PairBlockState[],
  inputs: Omit<PairWindowInputs, "syncs">,
  quoteUsd: QuoteUsdFn,
  ethUsdAt: EthUsdFn,
): BlockStateRow[] {
  const { pair, window, poolA, swapsPerBlock, gasSamples } = inputs;
  if (gasSamples.length === 0) {
    throw new Error("Brak cen gazu w blocks dla okna — uruchom backfill z etapu 1");
  }
  const gasXs = gasSamples.map((g) => g.block);
  const gasYs = gasSamples.map((g) => g.gwei);
  const gasAt = (b: number) => interpolateLinear(gasXs, gasYs, b);

  // percentyle w obrębie okna — po wszystkich blokach ze stanem (nie tylko z arbitrażem)
  const pct = {
    sortedSwapCounts: states.map((s) => swapsPerBlock.get(s.block) ?? 0).sort((a, b) => a - b),
    sortedGasGwei: states.map((s) => gasAt(s.block)).sort((a, b) => a - b),
  };

  return states.map((st) => {
    const q = quoteUsd(st.block, st);
    // Cena ETH/USD do przeliczenia kosztu gazu (cecha G) — źródło NIEZALEŻNE od `quoteUsd`
    // (patrz `makeEthUsd`): własna cena puli A dla par z quote-stablecoinem,
    // referencja WETH/USDC dla pary kwotowanej w WETH.
    const ethUsd = ethUsdAt(st.block, st.a.price);
    const gwei = gasAt(st.block);
    const swaps = swapsPerBlock.get(st.block) ?? 0;
    const tvlMinUsd = Math.min(st.a.tvlQuote, st.b.tvlQuote) * q;
    const arb = arbitrage(st.a, st.b, poolA.feeBps);
    const toUsd = (x: bigint) => (Number(x) / 10 ** pair.decQuote) * q;
    const optTradeUsd = toUsd(arb.tradeIn);
    const grossProfitUsd = toUsd(arb.profit);
    const net = arb.direction === "none" ? 0 : baselineNetProfitUsd(grossProfitUsd, gwei, ethUsd);
    const f = computeRawFeatures({ spreadPct: st.spreadPct, tvlMinUsd, gasPriceGwei: gwei, ethUsd, swapsInBlock: swaps }, pct);
    return {
      pairId: pair.id,
      windowId: window.id,
      block: st.block,
      priceA: st.a.price,
      priceB: st.b.price,
      spreadPct: st.spreadPct,
      tvlMinUsd,
      gasPriceMedian: gwei,
      swapsInBlock: swaps,
      s: f.S,
      g: f.G,
      l: f.L,
      m: f.M,
      optTradeUsd,
      baselineNetProfitUsd: net,
      baselineFeasible: arb.direction !== "none" && net > 0,
      direction: arb.direction,
      grossProfitUsd,
    };
  });
}
