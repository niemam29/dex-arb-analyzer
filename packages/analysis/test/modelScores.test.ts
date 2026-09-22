// Ocena modelami — funkcje czyste, bez dostępu do bazy.
import { BaselineModel, MamdaniModel } from "@dex-arb/core";
import { describe, expect, it } from "vitest";
import type { BlockStateRow } from "../src/analyzeWindow.js";
import { labelDistribution, scoreRows } from "../src/modelScores.js";

const row = (block: number, f: Partial<BlockStateRow>): BlockStateRow => ({
  pairId: 1, windowId: 1, block, priceA: 4000, priceB: 4000, spreadPct: 0, tvlMinUsd: 3e8, gasPriceMedian: 100,
  swapsInBlock: 0, s: 0, g: 0.1, l: 100, m: 30, optTradeUsd: 0, baselineNetProfitUsd: 0, baselineFeasible: false,
  direction: "none", grossProfitUsd: 0, ...f,
});

describe("scoreRows", () => {
  it("baseline: etykieta z net > 0", () => {
    const out = scoreRows(
      [row(1, {}), row(2, { optTradeUsd: 10_000, baselineNetProfitUsd: 50, baselineFeasible: true })],
      { id: 7, kind: "baseline", model: new BaselineModel() },
    );
    expect(out).toEqual([
      { modelId: 7, pairId: 1, block: 1, score: 0, label: "niewykonalna" },
      { modelId: 7, pairId: 1, block: 2, score: 50, label: "wykonalna" },
    ]);
  });

  it("mamdani: scenariusz S1-podobny daje wysoką ocenę, S=0 niewykonalna", () => {
    const out = scoreRows(
      [row(1, { s: 0.05 }), row(2, { s: 2.0, g: 0.1, l: 100, m: 20 })],
      { id: 8, kind: "mamdani", model: new MamdaniModel() },
    );
    expect(out[0].label).toBe("niewykonalna");
    expect(out[1].label).toBe("atrakcyjna"); // R10: duża, niski, głęboka, niskie
    expect(out[1].score).toBeGreaterThan(75);
  });
});

describe("labelDistribution", () => {
  it("udziały procentowe wszystkich czterech etykiet", () => {
    const d = labelDistribution([
      { modelId: 1, pairId: 1, block: 1, score: 0, label: "niewykonalna" },
      { modelId: 1, pairId: 1, block: 2, score: 0, label: "niewykonalna" },
      { modelId: 1, pairId: 1, block: 3, score: 40, label: "ryzykowna" },
      { modelId: 1, pairId: 1, block: 4, score: 90, label: "atrakcyjna" },
    ]);
    expect(d).toEqual({ niewykonalna: 50, ryzykowna: 25, wykonalna: 0, atrakcyjna: 25 });
  });

  it("pusta tablica -> wszystkie udziały 0", () => {
    expect(labelDistribution([])).toEqual({ niewykonalna: 0, ryzykowna: 0, wykonalna: 0, atrakcyjna: 0 });
  });
});
