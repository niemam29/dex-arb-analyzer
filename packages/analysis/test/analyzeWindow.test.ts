import { describe, expect, it } from "vitest";
import { computeBlockStates } from "../src/analyzeWindow.js";
import { makeEthUsd, makeQuoteUsd } from "../src/quoteUsd.js";
import { buildPairStates } from "../src/reserveStates.js";

const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const pairSpec = { tokenBase: WETH, tokenQuote: USDC, decBase: 18, decQuote: 6 };
const spec = { token0: USDC, token1: WETH };
const inputs = {
  pair: { id: 1, symbol: "WETH/USDC", tokenBase: WETH, tokenQuote: USDC, decBase: 18, decQuote: 6, baseSymbol: "WETH", quoteSymbol: "USDC" },
  window: { id: 1, fromBlock: 12435090, toBlock: 12435097 },
  poolA: { poolId: 1, ...spec, feeBps: 30 },
  poolB: { poolId: 2, ...spec, feeBps: 30 },
  swapsPerBlock: new Map([
    [12435096, 3],
    [12435097, 1],
  ]),
  gasSamples: [
    { block: 12435090, gwei: 100 },
    { block: 12435097, gwei: 170 },
  ],
};
// blok 12435096: rezerwy z planu (spread 1,0512 %); w 12435090 obie pule równe (spread 0)
const syncs = [
  { poolId: 1, block: 12435090, logIndex: 1, reserve0: 4000n * 10n ** 6n * 1000n, reserve1: 1000n * 10n ** 18n },
  { poolId: 2, block: 12435090, logIndex: 2, reserve0: 4000n * 10n ** 6n * 1000n, reserve1: 1000n * 10n ** 18n },
  { poolId: 1, block: 12435096, logIndex: 1, reserve0: 169305064440342n, reserve1: 42356593882140779981571n },
  { poolId: 2, block: 12435096, logIndex: 2, reserve0: 221259713450853n, reserve1: 54778704454503840386307n },
];

describe("computeBlockStates", () => {
  const states = buildPairStates(syncs, inputs.poolA, inputs.poolB, pairSpec, inputs.window.toBlock);
  const rows = computeBlockStates(states, inputs, makeQuoteUsd("USDC"), makeEthUsd("USDC", "WETH"));

  it("jeden wiersz na blok od pierwszego wspólnego stanu do końca okna", () => {
    expect(rows.map((r) => r.block)).toEqual([
      12435090, 12435091, 12435092, 12435093, 12435094, 12435095, 12435096, 12435097,
    ]);
  });
  it("blok bez arbitrażu: optTrade 0, baseline niewykonalny, gaz interpolowany", () => {
    const r = rows[0]!;
    expect(r.spreadPct).toBe(0);
    expect(r.optTradeUsd).toBe(0);
    expect(r.direction).toBe("none");
    expect(r.baselineFeasible).toBe(false);
    expect(r.gasPriceMedian).toBe(100);
    expect(rows[1]!.gasPriceMedian).toBeCloseTo(110); // liniowo 100→170 na 7 blokach
    expect(r.swapsInBlock).toBe(0);
  });
  it("blok 12435096: Δy*, zysk brutto i netto w USD, cechy S/G/L/M", () => {
    const r = rows.find((x) => x.block === 12435096)!;
    expect(r.direction).toBe("a->b");
    expect(r.optTradeUsd).toBeCloseTo(213_525.872521, 3);
    expect(r.grossProfitUsd).toBeCloseTo(475.469908, 3);
    expect(r.gasPriceMedian).toBeCloseTo(160);
    // gaz: 220000·160e-9·3997.136 = 140.70 USD
    expect(r.baselineNetProfitUsd).toBeCloseTo(475.469908 - 220_000 * 160e-9 * r.priceA, 2);
    expect(r.baselineFeasible).toBe(true);
    expect(r.s).toBeCloseTo(1.0512, 3);
    expect(r.g).toBeCloseTo(((220_000 * 160e-9 * r.priceA) / 50_000) * 100, 6);
    expect(r.l).toBe(100); // TVL 338 mln > 100
    expect(r.tvlMinUsd).toBeCloseTo(338_610_128.88, 0);
    // M: swapsInBlock=3 jest max z 8 bloków -> pct 1; gaz 160 -> 7/8 bloków ≤ 160 -> 0.875
    expect(r.m).toBeCloseTo(100 * (0.5 * 1 + 0.5 * 0.875));
  });
  it("percentyle liczone po wszystkich blokach okna (bloki bez swapów = 0)", () => {
    // 6 z 8 bloków ma 0 swapów -> pct(0) = 0.75
    expect(rows[0]!.m).toBeCloseTo(100 * (0.5 * 0.75 + 0.5 * (1 / 8)));
  });
});

describe("makeQuoteUsd", () => {
  it("stablecoin = 1, WETH z referencji, inne rzuca", () => {
    expect(makeQuoteUsd("USDC")(1, {} as never)).toBe(1);
    expect(makeQuoteUsd("DAI")(1, {} as never)).toBe(1);
    expect(makeQuoteUsd("WETH", () => 3000)(1, {} as never)).toBe(3000);
    expect(() => makeQuoteUsd("WETH")).toThrow(/WETH\/USDC/);
    expect(() => makeQuoteUsd("WBTC")).toThrow();
  });
});

describe("makeEthUsd", () => {
  it("quote-stablecoin, base=WETH -> własna cena puli A (nie stała 1, jak quoteUsd)", () => {
    expect(makeEthUsd("USDC", "WETH")(1, 4321.5)).toBe(4321.5);
    expect(makeEthUsd("USDT", "WETH")(1, 4000)).toBe(4000);
    expect(makeEthUsd("DAI", "WETH")(1, 3999)).toBe(3999);
  });
  it("quote-stablecoin, base != WETH -> rzuca po polsku (koszt gazu jest zawsze w ETH)", () => {
    expect(() => makeEthUsd("USDC", "WBTC")).toThrow(/WBTC/);
  });
  it("quote=WETH -> z referencji (nie z ceny puli A, bo ta jest w innej skali)", () => {
    expect(makeEthUsd("WETH", "WBTC", () => 4000)(150, 15.2)).toBe(4000);
  });
  it("quote=WETH bez referencji -> rzuca po polsku", () => {
    expect(() => makeEthUsd("WETH", "WBTC")).toThrow(/WETH\/USDC/);
  });
  it("nieobsługiwany quote -> rzuca", () => {
    expect(() => makeEthUsd("WBTC", "WETH")).toThrow();
  });
});

describe("computeBlockStates: WBTC/WETH — ethUsd z referencji, nie z ceny własnej puli", () => {
  const WBTC = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";
  const decBase = 8;
  const decQuote = 18;
  const pairSpecWbtcWeth = { tokenBase: WBTC, tokenQuote: WETH, decBase, decQuote };
  const poolSpecWbtcWeth = { token0: WBTC, token1: WETH };
  const wbtcInputs = {
    pair: {
      id: 4, symbol: "WBTC/WETH", tokenBase: WBTC, tokenQuote: WETH,
      decBase, decQuote, baseSymbol: "WBTC", quoteSymbol: "WETH",
    },
    window: { id: 2, fromBlock: 100, toBlock: 100 },
    poolA: { poolId: 1, ...poolSpecWbtcWeth, feeBps: 30 },
    poolB: { poolId: 2, ...poolSpecWbtcWeth, feeBps: 30 },
    swapsPerBlock: new Map<number, number>(),
    gasSamples: [{ block: 100, gwei: 100 }],
  };
  // 100 WBTC / 1500 WETH w obu pulach -> 15 WETH/WBTC, brak spreadu (upraszcza test cech S/G/L).
  const syncsWbtcWeth = [
    { poolId: 1, block: 100, logIndex: 1, reserve0: 100n * 10n ** 8n, reserve1: 1_500n * 10n ** 18n },
    { poolId: 2, block: 100, logIndex: 1, reserve0: 100n * 10n ** 8n, reserve1: 1_500n * 10n ** 18n },
  ];
  const refEthUsd = () => 4000; // stub referencji WETH/USDC dla tego okna
  const states = buildPairStates(syncsWbtcWeth, wbtcInputs.poolA, wbtcInputs.poolB, pairSpecWbtcWeth, wbtcInputs.window.toBlock);
  const rows = computeBlockStates(states, wbtcInputs, makeQuoteUsd("WETH", refEthUsd), makeEthUsd("WETH", "WBTC", refEthUsd));

  it("tvlMinUsd: 2 x 1500 WETH x 4000 USD/WETH (referencja), nie x cena własnej puli (~15)", () => {
    expect(rows[0]!.tvlMinUsd).toBeCloseTo(2 * 1_500 * 4000, 0); // 12 000 000 USD
  });
  it("g: koszt gazu liczony z ethUsd=4000 (referencja), NIE z priceA (~15 WETH/WBTC)", () => {
    const expectedG = ((220_000 * 100e-9 * 4000) / 50_000) * 100;
    expect(rows[0]!.g).toBeCloseTo(expectedG, 6);
    expect(rows[0]!.g).not.toBeCloseTo(((220_000 * 100e-9 * 15) / 50_000) * 100, 3);
  });
});
