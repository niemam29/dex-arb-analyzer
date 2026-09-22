// Testy `evaluatePopulations`/`evaluateRows`/`hasKnownLabel` — dwie populacje ewaluacji (ADR 0008),
// bez bazy (syntetyczne LabeledRow[]).
import { describe, expect, it } from "vitest";
import type { LabeledRow } from "@dex-arb/analysis";
import { ModelEvaluationSchema } from "@dex-arb/shared";
import { evaluatePopulations, evaluateRows, hasKnownLabel } from "../../src/jobs/evaluatePopulations.js";

const base: LabeledRow = { pairId: 1, windowId: 2, block: 0, s: 1, g: 0.1, l: 100, m: 50, netProfitUsd: 0, optTradeUsd: 0, grossProfitUsd: 0, isOpportunity: false, verified: false, label: 0, estProfitUsd: null, consumerTxHash: null, blocksToConsumption: null, gasCostUsd: null };
const bg = (block: number): LabeledRow => ({ ...base, block });
const opp = (block: number, label: 0 | 1, route: "two_pool" | "multi" | null = "two_pool"): LabeledRow => ({ ...base, block, isOpportunity: true, verified: true, label, route, consumerTxHash: `0x${block}` });
const unverified = (block: number): LabeledRow => ({ ...base, block, isOpportunity: true, verified: false });

describe("hasKnownLabel", () => {
  it("tło tak; zweryfikowana two_pool tak; multi nie; niezweryfikowana okazja nie", () => {
    expect(hasKnownLabel(bg(1))).toBe(true);
    expect(hasKnownLabel(opp(2, 1))).toBe(true);
    expect(hasKnownLabel(opp(3, 0, "multi"))).toBe(false);
    expect(hasKnownLabel(unverified(4))).toBe(false);
  });
});

describe("evaluatePopulations", () => {
  const rows = [bg(1), bg(2), bg(3), opp(10, 1), opp(11, 0), opp(12, 0, "multi"), unverified(13)];
  const scoreOf = (r: LabeledRow): number => (r.block >= 10 ? 90 : 10);
  it("population_block_states = tło + zweryfikowane znane (5); population_verified = tylko zweryfikowane znane (2)", () => {
    const p = evaluatePopulations(scoreOf, rows, []);
    expect(p.population_block_states.train.n).toBe(5);
    expect(p.population_block_states.train.positives).toBe(1);
    expect(p.population_verified.train.n).toBe(2);
    expect(p.population_verified.train.positives).toBe(1);
    expect(p.population_block_states.test).toBeNull();
    expect(p.population_verified.test).toBeNull();
    // block_states: pozytyw (90) vs negatywy 3×tło (10) i opp(11) (90): 3 wygrane + 1 remis (0,5) / 4 = 0,875;
    // zweryfikowane: oba score 90 -> remis -> AUC 0,5
    expect(p.population_block_states.train.auc).toBe(0.875);
    expect(p.population_verified.train.auc).toBe(0.5);
  });
  it("kształt zgodny z ModelEvaluationSchema; auc null przy jednej klasie; przeżywa JSON", () => {
    const ev = evaluateRows(scoreOf, [bg(1), bg(2)]);
    expect(ev.auc).toBeNull();
    expect(() => ModelEvaluationSchema.parse(JSON.parse(JSON.stringify(ev)))).not.toThrow();
    expect(ev.roc[0]!.threshold).toBe(Infinity);
  });
});
