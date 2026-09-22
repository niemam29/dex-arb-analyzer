import { describe, it, expect } from "vitest";
import { AnfisModel, BaselineModel, BaselineV2Model, initFromMamdani } from "@dex-arb/core";
import { defaultLiveModels, liveFeatures, scoreLive } from "../../src/live/score.js";
import type { LivePairSample } from "../../src/live/sample.js";

/** Para ze spreadem 1,0134 % (fixture wartości z sampleLive). */
const spread1pct: LivePairSample = {
  pairId: 1,
  symbol: "WETH/USDC",
  poolA: { dexName: "uniswap-v2", price: 2296.3004151953796, reserveBase: 0n, reserveQuote: 0n, tvlQuote: 225856851.796122 },
  poolB: { dexName: "sushiswap", price: 2319.5712139119696, reserveBase: 0n, reserveQuote: 0n, tvlQuote: 356600000 },
  spreadPct: 1.0134039328042361,
  direction: "a_to_b",
  optTradeUsd: 141015.294741,
  grossProfitUsd: 287.542061,
  netProfitUsd: 281.4798279038842,
  tvlMinUsd: 225856851.796122,
  ethUsd: 2296.3004151953796,
  swapsPerBlock: 3 / 20,
};
const bv2Params = { gasUnits: 150000, arbGasRef: 220000, gasPriceFactor: 0.5, threshold: 0.42, weightOptTrade: 0, scale: 12.5, optTradeQuantiles: [0, 1, 2] };

describe("liveFeatures", () => {
  it("S/G/L jak computeRawFeatures; M = 50 gdy historia < 10 próbek", () => {
    const f = liveFeatures(spread1pct, 12, { swapsPerBlock: [0.1, 0.2], gasGwei: [11, 12] });
    expect(f.S).toBeCloseTo(1.0134039328042361, 10);
    // G = 220 000 · 12e-9 · 2296,30 / 50 000 · 100
    expect(f.G).toBeCloseTo(0.012124466192231604, 12);
    expect(f.L).toBe(100);
    expect(f.M).toBe(50);
    expect(f.netProfitUsd).toBeCloseTo(281.4798279038842, 9);
    expect(f.grossProfitUsd).toBeCloseTo(287.542061, 9);
    expect(f.optTradeUsd).toBeCloseTo(141015.294741, 9);
  });

  it("M z percentyli po historii (≥ 10 próbek): swapy 3/10 i gaz 12 wśród 10..19 -> 30", () => {
    const hist = { swapsPerBlock: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], gasGwei: [19, 18, 17, 16, 15, 14, 13, 12, 11, 10] };
    const f = liveFeatures({ ...spread1pct, swapsPerBlock: 3 }, 12, hist);
    expect(f.M).toBeCloseTo(30, 9);
    // wartości poniżej minimum historii -> 0 (jak percentileRank)
    expect(liveFeatures({ ...spread1pct, swapsPerBlock: 0.5 }, 9, hist).M).toBe(0);
  });
});

describe("scoreLive", () => {
  const f = liveFeatures(spread1pct, 12, { swapsPerBlock: [], gasGwei: [] });

  it("baseline v1 i Mamdani zawsze; baseline_v2/anfis null bez parametrów", () => {
    const s = scoreLive(f, defaultLiveModels());
    expect(s.baseline).toEqual({ score: expect.closeTo(19.960943131798054, 9), label: "wykonalna" });
    expect(s.mamdani).toEqual({ score: expect.closeTo(40, 9), label: "ryzykowna" });
    expect(s.baseline_v2).toBeNull();
    expect(s.anfis).toBeNull();
  });

  it("baseline_v2 z parametrów i ANFIS z initFromMamdani() — deterministycznie", () => {
    const models = { baseline: new BaselineModel(), baselineV2: new BaselineV2Model(bv2Params), anfis: new AnfisModel(initFromMamdani()) };
    const s = scoreLive(f, models);
    expect(s.baseline_v2!.score).toBeCloseTo(100, 6);
    expect(s.baseline_v2!.label).toBe("atrakcyjna");
    expect(s.anfis!.score).toBeCloseTo(40.817738622799226, 9);
    expect(s.anfis!.label).toBe("ryzykowna");
  });

  it("blok bez kierunku (spread 0,00078 %): niewykonalna we wszystkich modelach", () => {
    const flat = { ...spread1pct, spreadPct: 0.0007818133211092222, direction: "none" as const, optTradeUsd: 0, grossProfitUsd: 0, netProfitUsd: 0 };
    const s = scoreLive(liveFeatures(flat, 12, { swapsPerBlock: [], gasGwei: [] }), { baseline: new BaselineModel(), baselineV2: new BaselineV2Model(bv2Params), anfis: new AnfisModel(initFromMamdani()) });
    expect(s.baseline).toEqual({ score: 0, label: "niewykonalna" });
    expect(s.mamdani!.score).toBeCloseTo(11.61474926253688, 9);
    expect(s.mamdani!.label).toBe("niewykonalna");
    expect(s.baseline_v2).toEqual({ score: 0, label: "niewykonalna" });
    expect(s.anfis!.score).toBeCloseTo(15.000265371863284, 9);
    expect(s.anfis!.label).toBe("niewykonalna");
  });
});
