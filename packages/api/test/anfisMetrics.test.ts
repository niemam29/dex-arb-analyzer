// Testy odczytu `scoring_models.metrics` (bez bazy) — `metricsSummaryFrom`/`anfisExtrasFrom`
// przez `AnfisMetricsReadSchema` (ADR 0008, dwie populacje ewaluacji).
import { describe, expect, it } from "vitest";
import { anfisExtrasFrom, metricsSummaryFrom } from "../src/anfisMetrics.js";

const ev = (auc: number | null, f1: number) => ({ n: 10, positives: 2, threshold: 50, confusion: { tp: 1, fp: 1, fn: 1, tn: 7 }, precision: 0.5, recall: 0.5, f1, auc, roc: [], histogram: { edges: [], positive: [], negative: [] } });

describe("metricsSummaryFrom", () => {
  it("nowy kształt: population_verified.test (albo train) jako 'verified_opportunities'", () => {
    const m = { population_block_states: { train: ev(0.99, 0.3), test: ev(0.998, 0.2) }, population_verified: { train: ev(0.71, 0.39), test: ev(0.787, 0.3) } };
    expect(metricsSummaryFrom(m)).toEqual({ population: "verified_opportunities", auc: 0.787, f1: 0.3 });
    expect(metricsSummaryFrom({ ...m, population_verified: { train: ev(0.71, 0.39), test: null } })).toEqual({ population: "verified_opportunities", auc: 0.71, f1: 0.39 });
  });
  it("stary kształt: test ?? train jako 'block_states'; auc null / brak -> undefined", () => {
    expect(metricsSummaryFrom({ train: { auc: 0.81, f1: 0.6 }, test: { auc: 0.77, f1: 0.55 } })).toEqual({ population: "block_states", auc: 0.77, f1: 0.55 });
    expect(metricsSummaryFrom({ train: { auc: 0.81, f1: 0.6 }, test: null })).toEqual({ population: "block_states", auc: 0.81, f1: 0.6 });
    expect(metricsSummaryFrom({ population_verified: { train: ev(null, 0), test: null } })).toBeUndefined();
    expect(metricsSummaryFrom(null)).toBeUndefined();
    expect(metricsSummaryFrom("x")).toBeUndefined();
    expect(metricsSummaryFrom({ population: "verified_opportunities", calibration: { n: 1, positives: 1, auc: 1, f1: 1, precision: 1, recall: 1, thresholdNetUsd: null } })).toBeUndefined();
  });
});

describe("anfisExtrasFrom", () => {
  it("history bez lr (stare wiersze) i z lr; kolumna trained_on_window_ids ma pierwszeństwo", () => {
    const m = { history: [{ epoch: 1, trainLoss: 0.5, valLoss: 0.6 }], classWeights: { pos: 3, neg: 1 }, trainWindows: [9] };
    expect(anfisExtrasFrom(m, [2])).toEqual({ class_weights: { pos: 3, neg: 1 }, history: [{ epoch: 1, train_loss: 0.5, val_loss: 0.6 }], trained_on_window_ids: [2] });
    expect(anfisExtrasFrom(m, null).trained_on_window_ids).toEqual([9]);
    expect(anfisExtrasFrom({ history: "zle" }, null)).toEqual({});
  });
});
