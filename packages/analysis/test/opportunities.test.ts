// Wykrywanie okazji — funkcja czysta, próg 0,65 % (ostro), kierunek i szacowany
// zysk = baseline netto.
import { describe, expect, it } from "vitest";
import type { BlockStateRow } from "../src/analyzeWindow.js";
import { OPPORTUNITY_THRESHOLD_PCT, detectOpportunities } from "../src/opportunities.js";

const row = (block: number, spreadPct: number, extra: Partial<BlockStateRow> = {}): BlockStateRow => ({
  pairId: 1, windowId: 1, block, priceA: 4000, priceB: 4000 * (1 + spreadPct / 100), spreadPct, tvlMinUsd: 3e8,
  gasPriceMedian: 100, swapsInBlock: 0, s: Math.min(spreadPct, 3), g: 0.1, l: 100, m: 50,
  optTradeUsd: 1000, baselineNetProfitUsd: -10, baselineFeasible: false, direction: "a->b", grossProfitUsd: 5, ...extra,
});

describe("detectOpportunities", () => {
  it("próg 0,65 % (ostro), kierunek i est. zysk = baseline netto", () => {
    expect(OPPORTUNITY_THRESHOLD_PCT).toBe(0.65);
    const out = detectOpportunities([row(1, 0.65), row(2, 0.6501, { baselineNetProfitUsd: 12.5 }), row(3, 0.1)]);
    expect(out).toEqual([{ pairId: 1, windowId: 1, block: 2, spreadPct: 0.6501, direction: "a->b", estProfitUsd: 12.5 }]);
  });

  it("kierunek z cen gdy arbitrage() dał none (np. bardzo płytka pula)", () => {
    const out = detectOpportunities([row(5, 2, { direction: "none", priceA: 4100, priceB: 4000 })]);
    expect(out[0].direction).toBe("b->a");
  });

  it("wielkość progu jest parametryzowalna (drugi argument)", () => {
    const out = detectOpportunities([row(1, 1.0)], 1.5);
    expect(out).toEqual([]);
  });
});
