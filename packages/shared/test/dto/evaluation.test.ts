import { describe, it, expect } from "vitest";
import { EvaluationDto } from "../../src/dto/evaluation.js";

const baseEvaluation = {
  model: { id: 1, name: "mamdani-v1", kind: "mamdani" as const, version: 1 },
  window: { id: 1, name: "maj 2021" },
  n: 8,
  n_positive: 4,
  confusion: { tp: 3, fp: 1, tn: 3, fn: 1 },
  precision: 0.75,
  recall: 0.75,
  f1: 0.75,
  auc: 0.9,
  auc_ci95: [0.8, 0.95] as [number, number],
  pr_auc: 0.85,
  roc: { fpr: [0, 0.25, 1], tpr: [0, 0.75, 1] },
  histogram: { edges: [0, 50, 100], positive: [1, 3], negative: [3, 1] },
};

describe("EvaluationDto", () => {
  it("parsuje ewaluację modelu Mamdaniego (bez pól ANFIS-owych)", () => {
    const r = EvaluationDto.safeParse(baseEvaluation);
    expect(r.success).toBe(true);
  });

  it("window: null oznacza wszystkie zweryfikowane okna", () => {
    const r = EvaluationDto.safeParse({ ...baseEvaluation, window: null });
    expect(r.success).toBe(true);
  });

  it("auc: null gdy niepoliczalne (brak przykładów jednej z klas)", () => {
    const r = EvaluationDto.safeParse({ ...baseEvaluation, auc: null, auc_ci95: null, pr_auc: null });
    expect(r.success).toBe(true);
  });

  it("przyjmuje opcjonalne pola ANFIS (class_weights, history, trained_on_window_ids)", () => {
    const r = EvaluationDto.safeParse({
      ...baseEvaluation,
      model: { ...baseEvaluation.model, kind: "anfis" },
      class_weights: { pos: 5, neg: 1 },
      history: [
        { epoch: 1, train_loss: 0.5, val_loss: 0.6 },
        { epoch: 2, train_loss: 0.4, val_loss: 0.55 },
      ],
      trained_on_window_ids: [1, 2],
    });
    expect(r.success).toBe(true);
  });

  it("odrzuca confusion z brakującym polem", () => {
    const r = EvaluationDto.safeParse({ ...baseEvaluation, confusion: { tp: 1, fp: 1, tn: 1 } });
    expect(r.success).toBe(false);
  });

  it("odrzuca nieznany kind modelu", () => {
    const r = EvaluationDto.safeParse({ ...baseEvaluation, model: { ...baseEvaluation.model, kind: "svm" } });
    expect(r.success).toBe(false);
  });

  it("odrzuca ujemne liczności w histogramie", () => {
    const r = EvaluationDto.safeParse({ ...baseEvaluation, histogram: { edges: [0, 50, 100], positive: [-1, 3], negative: [3, 1] } });
    expect(r.success).toBe(false);
  });

  // --- spójność długości roc/histogram, zakresy [0,1] ---

  it("odrzuca roc z niezgodną długością fpr/tpr", () => {
    const r = EvaluationDto.safeParse({ ...baseEvaluation, roc: { fpr: [0, 0.25, 1], tpr: [0, 1] } });
    expect(r.success).toBe(false);
  });

  it("odrzuca histogram, gdy edges.length != positive.length + 1", () => {
    const r = EvaluationDto.safeParse({
      ...baseEvaluation,
      histogram: { edges: [0, 50, 100], positive: [1, 3, 0], negative: [3, 1] },
    });
    expect(r.success).toBe(false);
  });

  it("odrzuca histogram, gdy edges.length != negative.length + 1", () => {
    const r = EvaluationDto.safeParse({
      ...baseEvaluation,
      histogram: { edges: [0, 50, 100], positive: [1, 3], negative: [3, 1, 0] },
    });
    expect(r.success).toBe(false);
  });

  it("odrzuca precision/recall/f1 poza [0,1]", () => {
    expect(EvaluationDto.safeParse({ ...baseEvaluation, precision: 1.5 }).success).toBe(false);
    expect(EvaluationDto.safeParse({ ...baseEvaluation, recall: -0.1 }).success).toBe(false);
    expect(EvaluationDto.safeParse({ ...baseEvaluation, f1: 1.01 }).success).toBe(false);
  });

  it("odrzuca auc poza [0,1] (gdy nie null)", () => {
    expect(EvaluationDto.safeParse({ ...baseEvaluation, auc: 1.2 }).success).toBe(false);
    expect(EvaluationDto.safeParse({ ...baseEvaluation, auc: -0.01 }).success).toBe(false);
  });
});
