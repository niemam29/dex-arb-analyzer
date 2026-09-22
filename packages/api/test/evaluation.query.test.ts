// Czysta część ewaluacji (bez bazy) — te same liczby zwraca endpoint i `export-results`.
import { describe, expect, it } from "vitest";
import { computeEvaluationMetrics } from "../src/queries/evaluation.sql.js";

describe("computeEvaluationMetrics", () => {
  const scores = [80, 90, 30, 70, 20, 10, 60];
  const actual = [true, true, true, false, false, false, false];

  it("macierz pomyłek przy progu 50 zgodna z ręcznym rachunkiem; CI obejmuje AUC; PR-AUC w (0,1]", () => {
    const m = computeEvaluationMetrics(scores, actual, { bootstrapN: 200 });
    expect(m.n).toBe(7);
    expect(m.n_positive).toBe(3);
    expect(m.confusion).toEqual({ tp: 2, fp: 2, tn: 2, fn: 1 });
    expect(m.auc).not.toBeNull();
    expect(m.auc_ci95![0]).toBeLessThanOrEqual(m.auc!);
    expect(m.auc_ci95![1]).toBeGreaterThanOrEqual(m.auc!);
    expect(m.pr_auc).toBeGreaterThan(0);
    expect(m.pr_auc).toBeLessThanOrEqual(1);
    expect(m.roc.fpr.length).toBe(m.roc.tpr.length);
    expect(m.histogram.edges.length).toBe(21);
  });

  it("jedna klasa: auc, auc_ci95 i pr_auc = null (bez pozytywów) / pr_auc = 1 (same pozytywy)", () => {
    const onlyNeg = computeEvaluationMetrics([10, 20], [false, false], { bootstrapN: 10 });
    expect(onlyNeg.auc).toBeNull();
    expect(onlyNeg.auc_ci95).toBeNull();
    expect(onlyNeg.pr_auc).toBeNull();
    const onlyPos = computeEvaluationMetrics([10, 20], [true, true], { bootstrapN: 10 });
    expect(onlyPos.auc).toBeNull();
    expect(onlyPos.pr_auc).toBe(1);
  });

  it("pusta populacja: n=0, wszystko zerowe/null, bez wyjątku", () => {
    const m = computeEvaluationMetrics([], [], { bootstrapN: 10 });
    expect(m.n).toBe(0);
    expect(m.auc).toBeNull();
    expect(m.pr_auc).toBeNull();
  });

  it("deterministyczne dla seeda", () => {
    expect(computeEvaluationMetrics(scores, actual, { bootstrapN: 100, seed: 3 })).toEqual(computeEvaluationMetrics(scores, actual, { bootstrapN: 100, seed: 3 }));
  });
});
