import { describe, expect, it } from "vitest";
import {
  ARB_GAS, REF_TRADE_USD, computeRawFeatures, gasCostUsd, interpolateLinear,
  percentileRank, spreadPct,
} from "../src/features.js";

describe("spreadPct", () => {
  it("względem tańszej puli, symetryczny", () => {
    expect(spreadPct(3715.4685, 3713.3708)).toBeCloseTo(0.0565, 4); // block_spreads.csv, blok 12429206
    expect(spreadPct(3713.3708, 3715.4685)).toBeCloseTo(0.0565, 4);
    expect(spreadPct(100, 100)).toBe(0);
  });
});

describe("gasCostUsd", () => {
  it("220k gazu × gwei × cena ETH", () => {
    expect(ARB_GAS).toBe(220_000);
    expect(REF_TRADE_USD).toBe(50_000);
    expect(gasCostUsd(100, 3000)).toBeCloseTo(66, 6); // 220000·100e-9·3000
  });
});

describe("percentileRank", () => {
  it("(#elementów ≤ x)/n jak w evaluate.ts", () => {
    const s = [0, 0, 1, 2, 5];
    expect(percentileRank(s, -1)).toBe(0);
    expect(percentileRank(s, 0)).toBe(0.4);
    expect(percentileRank(s, 1)).toBe(0.6);
    expect(percentileRank(s, 3)).toBe(0.8);
    expect(percentileRank(s, 5)).toBe(1);
    expect(percentileRank(s, 99)).toBe(1);
  });
});

describe("interpolateLinear", () => {
  it("interpoluje między próbkami i obcina na końcach", () => {
    const xs = [10, 20, 40], ys = [100, 200, 100];
    expect(interpolateLinear(xs, ys, 5)).toBe(100);
    expect(interpolateLinear(xs, ys, 10)).toBe(100);
    expect(interpolateLinear(xs, ys, 15)).toBe(150);
    expect(interpolateLinear(xs, ys, 30)).toBe(150);
    expect(interpolateLinear(xs, ys, 40)).toBe(100);
    expect(interpolateLinear(xs, ys, 99)).toBe(100);
  });
});

describe("computeRawFeatures", () => {
  const pct = { sortedSwapCounts: [0, 0, 1, 2, 5], sortedGasGwei: [50, 80, 100, 120, 300] };
  it("obcina S, G, L do dziedzin FIS", () => {
    const f = computeRawFeatures(
      { spreadPct: 7.7, tvlMinUsd: 235_658_000, gasPriceGwei: 2000, ethUsd: 3000, swapsInBlock: 99 }, pct,
    );
    expect(f.S).toBe(3);
    expect(f.G).toBe(2);
    expect(f.L).toBe(100);
    expect(f.M).toBe(100);
  });
  it("liczy G i M wg definicji z evaluate.ts", () => {
    const f = computeRawFeatures(
      { spreadPct: 1.0512, tvlMinUsd: 338_610_000, gasPriceGwei: 100, ethUsd: 3000, swapsInBlock: 1 }, pct,
    );
    expect(f.S).toBeCloseTo(1.0512, 6);
    expect(f.G).toBeCloseTo((66 / 50_000) * 100, 9);         // 0.132
    expect(f.L).toBe(100);
    expect(f.M).toBeCloseTo(100 * (0.5 * 0.6 + 0.5 * 0.6), 9); // 60
  });
});
