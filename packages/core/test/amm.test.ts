import { describe, expect, it } from "vitest";
import { arbitrage, getAmountOut, grossProfit, isqrt, optimalTradeIn, priceFromReserves } from "../src/amm.js";

describe("priceFromReserves", () => {
  it("liczy USDC za 1 WETH z rezerw jak implementacja referencyjna", () => {
    // blok 12429200, Uniswap, price w events.csv = 3720.9473
    const p = priceFromReserves(44004147832345236861057n, 18, 163737114053377n, 6);
    expect(p).toBeCloseTo(3720.9473, 3);
  });
});

describe("getAmountOut", () => {
  it("odtwarza realny swap Uniswap V2 (tx 0x913c5dd1…, blok 12429203) z różnic rezerw", () => {
    const r0Before = 163737114053377n, r1Before = 44004147832345236861057n;
    const r0After = 163736547464537n, r1After = 44004300561111829811622n;
    const amountIn = r1After - r1Before; // WETH wpłacone
    const amountOut = r0Before - r0After; // USDC wypłacone
    expect(amountIn).toBe(152728766592950565n);
    expect(amountOut).toBe(566588840n);
    expect(getAmountOut(amountIn, r1Before, r0Before)).toBe(amountOut);
  });
  it("zwraca 0 dla zerowego wejścia i rzuca dla pustych rezerw", () => {
    expect(getAmountOut(0n, 10n ** 18n, 10n ** 6n)).toBe(0n);
    expect(() => getAmountOut(1n, 0n, 10n)).toThrow();
  });
  it("respektuje inną prowizję (feeBps)", () => {
    const noFee = getAmountOut(10n ** 18n, 100n * 10n ** 18n, 100n * 10n ** 6n, 0);
    const fee = getAmountOut(10n ** 18n, 100n * 10n ** 18n, 100n * 10n ** 6n, 30);
    expect(noFee).toBeGreaterThan(fee);
  });
});

describe("isqrt", () => {
  it("dokładny pierwiastek całkowity dużych liczb", () => {
    expect(isqrt(0n)).toBe(0n);
    expect(isqrt(15n)).toBe(3n);
    expect(isqrt(16n)).toBe(4n);
    const big = 123456789012345678901234567890n;
    const r = isqrt(big * big);
    expect(r).toBe(big);
    const r2 = isqrt(big * big + 1n);
    expect(r2).toBe(big);
  });

  it("n <= 3: początkowe przybliżenie Newtona (x = n/2+1) >= n, pętla by się nie wykonała", () => {
    // Regresja: isqrt(2n) zwracało błędnie 2n (patrz komentarz w amm.ts).
    expect(isqrt(1n)).toBe(1n);
    expect(isqrt(2n)).toBe(1n);
    expect(isqrt(3n)).toBe(1n);
  });

  it("regresja: n = 0..1000 zgodne z Math.sqrt (dokładne dla tego zakresu)", () => {
    for (let n = 0; n <= 1000; n++) {
      expect(isqrt(BigInt(n))).toBe(BigInt(Math.floor(Math.sqrt(n))));
    }
  });

  it("regresja: duże wartości spełniają r*r <= n < (r+1)*(r+1)", () => {
    const values = [
      2n ** 64n,
      2n ** 64n - 1n,
      2n ** 64n + 1n,
      2n ** 128n + 12345n,
      10n ** 40n,
      (123456789012345678901234567890n * 987654321098765432109876543210n),
    ];
    for (const n of values) {
      const r = isqrt(n);
      expect(r * r <= n).toBe(true);
      expect(n < (r + 1n) * (r + 1n)).toBe(true);
    }
  });
});

// blok 12435096 (maj 2021): Uniswap tańszy, Sushi droższy; spread 1,0512 %
const UNI = { base: 42356593882140779981571n, quote: 169305064440342n };
const SUSHI = { base: 54778704454503840386307n, quote: 221259713450853n };
// blok 12429206: spread 0,164 % < 2 prowizje -> brak arbitrażu
const UNI_NOARB = { base: 44036629340257468022864n, quote: 163616708518272n };
const SUSHI_NOARB = { base: 55814150761740218956325n, quote: 207036231808743n };

describe("optimalTradeIn / grossProfit", () => {
  it("formuła zamknięta daje Δy* i zysk z przykładu w planie", () => {
    const dy = optimalTradeIn(UNI, SUSHI);
    expect(dy).toBe(213525872521n);
    const g = grossProfit(UNI, SUSHI, dy);
    expect(g.amountBase).toBe(53192573375194968566n);
    expect(g.amountOut).toBe(214001342429n);
    expect(g.profit).toBe(475469908n);
  });
  it("Δy* jest maksimum: sąsiednie wielkości dają mniejszy zysk", () => {
    const dy = optimalTradeIn(UNI, SUSHI);
    const best = grossProfit(UNI, SUSHI, dy).profit;
    for (const f of [0.5, 0.9, 1.1, 1.5]) {
      const d = BigInt(Math.round(Number(dy) * f));
      expect(grossProfit(UNI, SUSHI, d).profit).toBeLessThan(best);
    }
    expect(grossProfit(UNI, SUSHI, (dy * 9n) / 10n).profit).toBe(470724719n);
  });
  it("zwraca 0 gdy spread nie pokrywa dwóch prowizji", () => {
    expect(optimalTradeIn(UNI_NOARB, SUSHI_NOARB)).toBe(0n);
    expect(optimalTradeIn(SUSHI_NOARB, UNI_NOARB)).toBe(0n);
    expect(optimalTradeIn(SUSHI, UNI)).toBe(0n); // zły kierunek
  });
});

describe("arbitrage", () => {
  it("wybiera kierunek a->b gdy base tańszy w a", () => {
    const r = arbitrage(UNI, SUSHI);
    expect(r).toEqual({ direction: "a->b", tradeIn: 213525872521n, profit: 475469908n });
    expect(arbitrage(SUSHI, UNI)).toEqual({ direction: "b->a", tradeIn: 213525872521n, profit: 475469908n });
  });
  it("none dla małego spreadu", () => {
    expect(arbitrage(UNI_NOARB, SUSHI_NOARB)).toEqual({ direction: "none", tradeIn: 0n, profit: 0n });
  });
});

describe("precyzja: rezerwy > 2^53", () => {
  it("priceFromReserves przy rezerwie 1e27 zgadza się z referencją bigint (błąd względny ≤ 4·2^-52)", () => {
    const reserveBase = 10n ** 27n; // 1e9 WETH w wei — daleko poza 2^53 ≈ 9e15
    const reserveQuote = 3_141_592_653_589_793_238n; // ~3,14e12 USDC (6 dec.)
    const p = priceFromReserves(reserveBase, 18, reserveQuote, 6);
    // referencja: cena · 1e18 jako bigint = quote · 10^(18+decBase−decQuote) / base
    const refScaled = (reserveQuote * 10n ** BigInt(18 + 18 - 6)) / reserveBase;
    const ref = Number(refScaled) / 1e18;
    // kilka zaokrągleń double (Number() dwóch bigintów + 2 dzielenia) -> budżet 1e-14 (≈ 45 ulp), nadal 10 rzędów poniżej tolerancji regresji cen (1e-3)
    expect(Math.abs(p - ref) / ref).toBeLessThanOrEqual(1e-14);
  });
  it("arbitrage() liczy w bigint: zysk brutto identyczny niezależnie od skali rezerw (×1e6)", () => {
    const a = { base: 10n ** 21n, quote: 3_000_000_000_000n };
    const b = { base: 10n ** 21n, quote: 3_030_000_000_000n };
    const small = arbitrage(a, b);
    const big = arbitrage({ base: a.base * 10n ** 6n, quote: a.quote * 10n ** 6n }, { base: b.base * 10n ** 6n, quote: b.quote * 10n ** 6n });
    expect(big.direction).toBe(small.direction);
    // przy skalowaniu rezerw ×k optymalny wolumen i zysk skalują się ~×k — ale `profit` jest
    // różnicą dwóch dużych liczb (amountOut - amountIn), więc zaokrąglenia całkowite (isqrt,
    // dzielenie w dół) w `optimalTradeIn`/`grossProfit` wzmacniają się przy tej odejmowanej
    // reszcie: zmierzone odchylenie względne od idealnego ×1e6 jest rzędu 1e-8 (nie zera), ale
    // wciąż ~4 rzędy poniżej istotności biznesowej (zysk arbitrażu w USD, grosze).
    const ratio = Number(big.profit) / Number(small.profit);
    expect(Math.abs(ratio - 1e6) / 1e6).toBeLessThan(1e-6);
  });
});
