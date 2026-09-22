import { describe, expect, it } from "vitest";
import { BaselineModel, DEFAULT_BASELINE_PARAMS, baselineNetProfitUsd, baselineParamsSchema, parseBaselineParams } from "../src/baseline.js";
import { MamdaniModel } from "../src/mamdani.js";
import type { Features } from "../src/types.js";

const base: Features = { S: 1.05, G: 0.13, L: 100, M: 40, netProfitUsd: 0, grossProfitUsd: 0, optTradeUsd: 213_525.87 };

describe("baselineNetProfitUsd", () => {
  it("odejmuje koszt 220k gazu", () => {
    // brutto 475.47 USD, 100 gwei, ETH 4000 -> gaz 88 USD
    expect(baselineNetProfitUsd(475.47, 100, 4000)).toBeCloseTo(475.47 - 88, 6);
  });
});

describe("BaselineModel", () => {
  const m = new BaselineModel();
  it("net > 0 -> wykonalna, score = ROI·10000 obcięty do 100", () => {
    const r = m.score({ ...base, netProfitUsd: 387.47 });
    expect(r.label).toBe("wykonalna");
    expect(r.score).toBeCloseTo((387.47 / 213_525.87) * 10_000, 6); // ≈ 18.1
    expect(r.details).toMatchObject({ feasible: true });
  });
  it("net ≤ 0 -> niewykonalna, score 0", () => {
    expect(m.score({ ...base, netProfitUsd: -5 })).toMatchObject({ label: "niewykonalna", score: 0 });
    expect(m.score({ ...base, netProfitUsd: 0 })).toMatchObject({ label: "niewykonalna", score: 0 });
  });
  it("obcina score do 100 i obsługuje optTradeUsd = 0", () => {
    expect(m.score({ ...base, netProfitUsd: 50_000 }).score).toBe(100);
    expect(m.score({ ...base, optTradeUsd: 0, netProfitUsd: 0 })).toMatchObject({ label: "niewykonalna", score: 0 });
  });
});

describe("baselineParamsSchema / parseBaselineParams", () => {
  it("parsuje DEFAULT_BASELINE_PARAMS bez zmian", () => {
    expect(parseBaselineParams(DEFAULT_BASELINE_PARAMS)).toEqual(DEFAULT_BASELINE_PARAMS);
  });
  it("odrzuca ujemne/zerowe arbGas i roiScale", () => {
    expect(baselineParamsSchema.safeParse({ arbGas: 0, roiScale: 10_000 }).success).toBe(false);
    expect(baselineParamsSchema.safeParse({ arbGas: 220_000, roiScale: -1 }).success).toBe(false);
  });
  it("rzuca dla kształtu niezgodnego z BaselineParams (np. z jsonb bazy po nieudanej migracji)", () => {
    expect(() => parseBaselineParams({ arbGas: "220000" })).toThrow();
    expect(() => parseBaselineParams(null)).toThrow();
  });
  it("zmienione parametry dają inny wynik niż domyślne (BaselineModel faktycznie ich używa)", () => {
    const f: Features = { S: 1, G: 0.1, L: 100, M: 20, netProfitUsd: 100, grossProfitUsd: 100, optTradeUsd: 10_000 };
    const defaultScore = new BaselineModel(DEFAULT_BASELINE_PARAMS).score(f).score;
    const customScore = new BaselineModel(parseBaselineParams({ arbGas: 220_000, roiScale: 5_000 })).score(f).score;
    expect(customScore).not.toBe(defaultScore);
    expect(customScore).toBeCloseTo(defaultScore / 2, 6); // roiScale o połowę mniejszy -> score o połowę mniejszy
  });
});

describe("MamdaniModel", () => {
  it("opakowuje evaluateArbitrage (scenariusz S5 z projektu: S=2, G=0.1, L=1.5, M=20)", () => {
    const r = new MamdaniModel().score({ S: 2, G: 0.1, L: 1.5, M: 20, netProfitUsd: 0, grossProfitUsd: 0, optTradeUsd: 0 });
    expect(r.label).toBe("ryzykowna"); // R16: duża + płytka -> ryzykowna
    expect(r.score).toBeGreaterThan(25);
    expect(r.score).toBeLessThan(55);
    expect(Array.isArray((r.details as { activations: unknown[] }).activations)).toBe(true);
  });
});
