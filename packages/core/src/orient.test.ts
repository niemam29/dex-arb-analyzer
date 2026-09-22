// Orientacja puli (token0/token1 -> base/quote) i cena quote-za-base niezależna od tego, który
// token jest token0 w danej puli, oraz od liczby miejsc dziesiętnych obu tokenów.
import { describe, expect, it } from "vitest";
import { orientPool, quotePerBase } from "./orient.js";

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const WBTC = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";

describe("orientPool", () => {
  it("USDC/WETH (Uniswap V2): token0=USDC, token1=WETH -> base (WETH) jest token1", () => {
    const o = orientPool(
      { token0: USDC, token1: WETH, reserve0: 4_000_000n * 10n ** 6n, reserve1: 1_000n * 10n ** 18n },
      { tokenBase: WETH, tokenQuote: USDC, decBase: 18, decQuote: 6 },
    );
    expect(o).toEqual({ reserveBase: 1_000n * 10n ** 18n, reserveQuote: 4_000_000n * 10n ** 6n, baseIsToken0: false });
  });

  it("WETH/USDT (Uniswap V2): token0=WETH, token1=USDT -> base (WETH) jest token0 (jedyna taka para)", () => {
    const o = orientPool(
      { token0: WETH, token1: USDT, reserve0: 1_000n * 10n ** 18n, reserve1: 4_000_000n * 10n ** 6n },
      { tokenBase: WETH, tokenQuote: USDT, decBase: 18, decQuote: 6 },
    );
    expect(o).toEqual({ reserveBase: 1_000n * 10n ** 18n, reserveQuote: 4_000_000n * 10n ** 6n, baseIsToken0: true });
  });

  it("WBTC/WETH: token0=WBTC (8 dec), token1=WETH (18 dec) -> base (WBTC) jest token0", () => {
    const o = orientPool(
      { token0: WBTC, token1: WETH, reserve0: 100n * 10n ** 8n, reserve1: 1_500n * 10n ** 18n },
      { tokenBase: WBTC, tokenQuote: WETH, decBase: 8, decQuote: 18 },
    );
    expect(o).toEqual({ reserveBase: 100n * 10n ** 8n, reserveQuote: 1_500n * 10n ** 18n, baseIsToken0: true });
  });

  it("porównanie adresów bez uwzględniania wielkości liter", () => {
    const o = orientPool(
      { token0: USDC.toLowerCase(), token1: WETH.toUpperCase(), reserve0: 1n, reserve1: 2n },
      { tokenBase: WETH.toLowerCase(), tokenQuote: USDC.toUpperCase(), decBase: 18, decQuote: 6 },
    );
    expect(o).toEqual({ reserveBase: 2n, reserveQuote: 1n, baseIsToken0: false });
  });

  it("rzuca po polsku, gdy tokeny puli nie odpowiadają tokenom pary", () => {
    expect(() =>
      orientPool(
        { token0: USDC, token1: USDT, reserve0: 1n, reserve1: 1n },
        { tokenBase: WETH, tokenQuote: USDC, decBase: 18, decQuote: 6 },
      ),
    ).toThrow(/tokeny puli.*nie odpowiadają tokenom pary/i);
  });
});

describe("quotePerBase", () => {
  it("USDC/WETH: 4 000 000 USDC i 1 000 WETH -> 4000 USDC/WETH", () => {
    const o = orientPool(
      { token0: USDC, token1: WETH, reserve0: 4_000_000n * 10n ** 6n, reserve1: 1_000n * 10n ** 18n },
      { tokenBase: WETH, tokenQuote: USDC, decBase: 18, decQuote: 6 },
    );
    expect(quotePerBase(o, 18, 6)).toBeCloseTo(4000, 6);
  });

  it("WETH/USDT (token0=WETH): 1 000 WETH i 4 000 000 USDT -> 4000 USDT/WETH", () => {
    const o = orientPool(
      { token0: WETH, token1: USDT, reserve0: 1_000n * 10n ** 18n, reserve1: 4_000_000n * 10n ** 6n },
      { tokenBase: WETH, tokenQuote: USDT, decBase: 18, decQuote: 6 },
    );
    expect(quotePerBase(o, 18, 6)).toBeCloseTo(4000, 6);
  });

  it("WBTC/WETH (8/18 dec): 100 WBTC i 1 500 WETH -> 15 WETH/WBTC", () => {
    const o = orientPool(
      { token0: WBTC, token1: WETH, reserve0: 100n * 10n ** 8n, reserve1: 1_500n * 10n ** 18n },
      { tokenBase: WBTC, tokenQuote: WETH, decBase: 8, decQuote: 18 },
    );
    expect(quotePerBase(o, 8, 18)).toBeCloseTo(15, 9);
  });

  it("ta sama para ekonomiczna, dwa różne układy token0/token1, daje tę samą cenę", () => {
    const a = quotePerBase(
      orientPool(
        { token0: USDC, token1: WETH, reserve0: 4_000_000n * 10n ** 6n, reserve1: 1_000n * 10n ** 18n },
        { tokenBase: WETH, tokenQuote: USDC, decBase: 18, decQuote: 6 },
      ),
      18,
      6,
    );
    const b = quotePerBase(
      orientPool(
        { token0: WETH, token1: USDC, reserve0: 1_000n * 10n ** 18n, reserve1: 4_000_000n * 10n ** 6n },
        { tokenBase: WETH, tokenQuote: USDC, decBase: 18, decQuote: 6 },
      ),
      18,
      6,
    );
    expect(a).toBe(b);
  });
});
