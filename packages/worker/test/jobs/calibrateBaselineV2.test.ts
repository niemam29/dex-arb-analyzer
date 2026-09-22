// Testy części czystej zadania `calibrate:baseline_v2` — bez bazy.
import { describe, expect, it } from "vitest";
import type { LabeledRow } from "@dex-arb/analysis";
import type { Provenance } from "@dex-arb/shared";
import { calibrationRows, runCalibration, toBaselineV2Inputs } from "../../src/jobs/calibrateBaselineV2.js";

const PROVENANCE: Provenance = { gitSha: "0".repeat(40), nodeVersion: process.version, deps: { "@thi.ng/fuzzy": "0.0.0", "drizzle-orm": "0.0.0" }, rpcHost: null, windows: [], durationMs: 0, createdAt: new Date(0).toISOString() };

const baseRow = (block: number, o: Partial<LabeledRow> = {}): LabeledRow => ({
  pairId: 1,
  windowId: 1,
  block,
  s: 0.1,
  g: 0.2,
  l: 30,
  m: 40,
  netProfitUsd: 0,
  grossProfitUsd: 0,
  optTradeUsd: 0,
  isOpportunity: false,
  verified: false,
  label: 0,
  estProfitUsd: null,
  consumerTxHash: null,
  blocksToConsumption: null,
  gasCostUsd: null,
  ...o,
});

/** Syntetyczne wiersze: prawdziwy koszt gazu bota = 0,5 × szacunek v1; etykieta z szumem. */
function mk(n: number, seed: number, windowId = 1): LabeledRow[] {
  let a = seed;
  const r = () => (a = (a * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  return Array.from({ length: n }, (_, i) => {
    const isOpp = r() < 0.3;
    if (!isOpp) return baseRow(i, { windowId, grossProfitUsd: 0, netProfitUsd: 0 });
    const gross = r() * 200;
    const gasV1 = 20 + r() * 200;
    const label = (gross - 0.5 * gasV1 + (r() - 0.5) * 30 > 0 ? 1 : 0) as 0 | 1;
    return baseRow(i, {
      windowId,
      grossProfitUsd: gross,
      netProfitUsd: gross - gasV1,
      optTradeUsd: 1000 + r() * 50_000,
      isOpportunity: true,
      verified: true,
      label,
      consumerTxHash: label ? `0xtx${i}` : null,
      route: label ? "two_pool" : null,
    });
  });
}

describe("toBaselineV2Inputs / calibrationRows", () => {
  it("odtwarza koszt gazu v1 z brutto − netto (bez przybliżeń)", () => {
    expect(toBaselineV2Inputs(baseRow(1, { grossProfitUsd: 50, netProfitUsd: 20, optTradeUsd: 7 }))).toEqual({ grossProfitUsd: 50, gasCostV1Usd: 30, optTradeUsd: 7 });
    expect(toBaselineV2Inputs(baseRow(1, { grossProfitUsd: 0, netProfitUsd: -30 }))).toEqual({ grossProfitUsd: 0, gasCostV1Usd: 30, optTradeUsd: 0 });
  });
  it("populacja kalibracji: tylko zweryfikowane okazje o znanej etykiecie (bez route='multi', bez tła, bez niezweryfikowanych)", () => {
    const rows: LabeledRow[] = [
      baseRow(1),
      baseRow(2, { isOpportunity: true, verified: false }),
      baseRow(3, { isOpportunity: true, verified: true, label: 1, route: "two_pool", grossProfitUsd: 10 }),
      baseRow(4, { isOpportunity: true, verified: true, label: 0, route: null, grossProfitUsd: 5 }),
      baseRow(5, { isOpportunity: true, verified: true, label: 0, route: "multi", grossProfitUsd: 5 }),
    ];
    const cal = calibrationRows(rows);
    expect(cal).toHaveLength(2);
    expect(cal.map((c) => c.label)).toEqual([true, false]);
  });
});

describe("runCalibration", () => {
  it("wybiera gasPriceFactor < 1 na danych z tanim gazem, liczy holdout na okazjach testWindows, jest deterministyczne", () => {
    const train = mk(3000, 1, 1);
    const test = mk(1000, 2, 2);
    const a = runCalibration(train, test, { trainWindows: [1], testWindows: [2] }, PROVENANCE);
    expect(a.params.gasPriceFactor).toBeLessThan(1);
    expect(a.metrics.population).toBe("verified_opportunities");
    expect(a.metrics.calibration.auc).toBeGreaterThan(0.85);
    expect(a.metrics.holdout).not.toBeNull();
    expect(a.metrics.holdout!.auc).toBeGreaterThan(0.85);
    expect(a.metrics.holdout!.n).toBe(calibrationRows(test).length);
    expect(a.metrics.grid).toHaveLength(30);
    expect(a.metrics.trainWindows).toEqual([1]);
    // klucze celowo inne niż `train`/`test` (AnfisMetrics) — patrz komentarz w handlerze; ADR 0008
    // dodaje dwie populacje ewaluacji + `provenance` (wspólny kontrakt z `AnfisMetrics`).
    expect(Object.keys(a.metrics).sort()).toEqual(
      ["calibration", "grid", "holdout", "population", "population_block_states", "population_verified", "provenance", "testWindows", "trainWindows"].sort(),
    );
    expect(runCalibration(train, test, { trainWindows: [1], testWindows: [2] }, PROVENANCE)).toEqual(a);
  });
  it("testWindows puste -> holdout null", () => {
    const r = runCalibration(mk(1000, 3), [], { trainWindows: [1], testWindows: [] }, PROVENANCE);
    expect(r.metrics.holdout).toBeNull();
    expect(r.metrics.population_block_states.test).toBeNull();
    expect(r.metrics.population_verified.test).toBeNull();
  });
  it("rzuca, gdy zbiór kalibracyjny nie ma obu klas", () => {
    const rows = [baseRow(1, { isOpportunity: true, verified: true, label: 1, grossProfitUsd: 10 })];
    expect(() => runCalibration(rows, [], { trainWindows: [1], testWindows: [] }, PROVENANCE)).toThrow(/obie klasy/);
  });
});
