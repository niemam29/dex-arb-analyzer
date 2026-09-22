// Kurs tokena kwotowanego pary do USD. Stablecoiny = 1; WETH pobiera
// referencyjną cenę ETH/USD z wcześniej przeanalizowanej pary WETH/USDC tego samego okna
// (funkcja wstrzykiwana przez wywołującego — ten moduł tylko definiuje interfejs i błąd,
// gdy referencja nie jest dostępna).
import type { PairBlockState } from "./reserveStates.js";

export type QuoteUsdFn = (block: number, state: PairBlockState) => number;

const STABLES = new Set(["USDC", "USDT", "DAI"]);

/** Kurs tokena kwotowanego pary do USD (1 dla stablecoinów, referencja ETH/USD dla WETH). */
export function makeQuoteUsd(quoteSymbol: string, refEthUsd?: (block: number) => number): QuoteUsdFn {
  if (STABLES.has(quoteSymbol)) return () => 1;
  if (quoteSymbol === "WETH") {
    if (!refEthUsd) {
      throw new Error(
        "Para kwotowana w WETH wymaga wcześniej przeanalizowanej pary referencyjnej WETH/USDC w tym oknie",
      );
    }
    return (block) => refEthUsd(block);
  }
  throw new Error(`Nieobsługiwany token kwotowany: ${quoteSymbol}`);
}

/**
 * Kurs ETH/USD używany WYŁĄCZNIE do przeliczenia kosztu gazu na USD (cecha G) —
 * inny cel niż `quoteUsd` (przelicza wartości w jednostkach quote na USD). Gaz jest zawsze
 * płacony w ETH, niezależnie od tego, w czym kwotowana jest analizowana para:
 *  - para z quote-stablecoinem (WETH/USDC, WETH/USDT, WETH/DAI — w tym projekcie zawsze
 *    base = WETH) — własna cena puli A JEST kursem ETH/USD (nie trzeba referencji), ale TYLKO
 *    gdy base rzeczywiście jest WETH: dla hipotetycznej pary
 *    stable-quoted z innym base (np. WBTC/USDC) cena własnej puli A byłaby kursem WBTC/USD,
 *    nie ETH/USD, więc użycie jej do przeliczenia kosztu gazu (zawsze w ETH) byłoby ciche i
 *    błędne — stąd asercja `baseSymbol === "WETH"`;
 *  - para kwotowana w WETH (np. WBTC/WETH) — cena własnej puli A jest w innej skali
 *    (quote/base, nie ETH/USD), więc potrzebna jest ta sama referencja co `quoteUsd`,
 *    z wcześniej przeanalizowanej pary WETH/USDC w tym samym oknie.
 */
export type EthUsdFn = (block: number, priceOwnPoolA: number) => number;

export function makeEthUsd(quoteSymbol: string, baseSymbol: string, refEthUsd?: (block: number) => number): EthUsdFn {
  if (STABLES.has(quoteSymbol)) {
    if (baseSymbol !== "WETH") {
      throw new Error(
        `Para kwotowana w stablecoinie z base „${baseSymbol}" (nie WETH) nie ma zdefiniowanego kursu ETH/USD z ceny własnej puli — koszt gazu jest zawsze w ETH`,
      );
    }
    return (_block, priceOwnPoolA) => priceOwnPoolA;
  }
  if (quoteSymbol === "WETH") {
    if (!refEthUsd) {
      throw new Error(
        "Para kwotowana w WETH wymaga wcześniej przeanalizowanej pary referencyjnej WETH/USDC w tym oknie",
      );
    }
    return (block) => refEthUsd(block);
  }
  throw new Error(`Nieobsługiwany token kwotowany: ${quoteSymbol}`);
}
