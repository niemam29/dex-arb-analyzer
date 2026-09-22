import { describe, it, expect } from "vitest";
import { CalibrateBaselineV2Request, ModelDto, TrainRequest } from "../../src/dto/models.js";

describe("ModelDto", () => {
  it("parsuje model mamdani", () => {
    const r = ModelDto.safeParse({
      id: 1,
      name: "mamdani-v1",
      kind: "mamdani",
      version: 1,
      created_at: "2026-08-26T10:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });
  it("akceptuje kind baseline_v2 z opcjonalnymi params (GET /models dołącza je tylko dla tego kind)", () => {
    const base = { id: 3, name: "baseline_v2", kind: "baseline_v2" as const, version: 1, created_at: "2026-08-26T10:00:00.000Z" };
    expect(ModelDto.safeParse(base).success).toBe(true);
    expect(ModelDto.safeParse({ ...base, params: { gasUnits: 150000, gasPriceFactor: 0.5, threshold: 0.4, weightOptTrade: 0 } }).success).toBe(true);
    expect(ModelDto.safeParse({ ...base, params: "x" }).success).toBe(false);
  });
  it("CalibrateBaselineV2Request: train_windows wymagane, test_windows domyślnie [], name opcjonalne", () => {
    expect(CalibrateBaselineV2Request.parse({ train_windows: [2] })).toEqual({ train_windows: [2], test_windows: [] });
    expect(CalibrateBaselineV2Request.safeParse({ train_windows: [] }).success).toBe(false);
    expect(CalibrateBaselineV2Request.safeParse({ train_windows: [2], epochs: 5 }).success).toBe(true); // nieznane klucze ignorowane jak w TrainRequest
    expect(CalibrateBaselineV2Request.parse({ train_windows: [2], test_windows: [3], name: "bv2" }).name).toBe("bv2");
  });
  it("odrzuca nieznany kind (spoza baseline|baseline_v2|mamdani|anfis — zgodnie z model_kind DB enum)", () => {
    const r = ModelDto.safeParse({
      id: 1,
      name: "x",
      kind: "svm",
      version: 1,
      created_at: "2026-08-26T10:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });
  it("training_metrics_summary jest opcjonalne i wymaga population='block_states'", () => {
    const base = { id: 1, name: "anfis-v1", kind: "anfis" as const, version: 1, created_at: "2026-08-26T10:00:00.000Z" };
    expect(ModelDto.safeParse(base).success).toBe(true);
    expect(ModelDto.safeParse({ ...base, training_metrics_summary: { population: "block_states", auc: 0.91, f1: 0.5 } }).success).toBe(true);
    // bez population / z inną populacją — odrzucone (pole ma jawnie oznaczać, na czym liczono)
    expect(ModelDto.safeParse({ ...base, training_metrics_summary: { auc: 0.91, f1: 0.5 } }).success).toBe(false);
    expect(ModelDto.safeParse({ ...base, training_metrics_summary: { population: "opportunities", auc: 0.91, f1: 0.5 } }).success).toBe(false);
    expect(ModelDto.safeParse({ ...base, training_metrics_summary: { population: "block_states", auc: "0.91" } }).success).toBe(false);
  });
});

describe("TrainRequest", () => {
  it("wymaga co najmniej jednego okna treningowego i domyślnie pustych okien testowych", () => {
    const r = TrainRequest.parse({ train_windows: [1] });
    expect(r).toMatchObject({ train_windows: [1], test_windows: [] });
    expect(TrainRequest.safeParse({ train_windows: [] }).success).toBe(false);
    expect(TrainRequest.safeParse({}).success).toBe(false);
  });
  it("przyjmuje opcjonalne seed/epochs/lr/name", () => {
    const r = TrainRequest.parse({
      train_windows: [1],
      test_windows: [2],
      seed: 7,
      epochs: 100,
      lr: 0.02,
      name: "anfis-test",
    });
    expect(r).toMatchObject({ seed: 7, epochs: 100, lr: 0.02, name: "anfis-test" });
  });
  it("odrzuca epochs/lr poza dozwolonym zakresem", () => {
    expect(TrainRequest.safeParse({ train_windows: [1], epochs: 0 }).success).toBe(false);
    expect(TrainRequest.safeParse({ train_windows: [1], epochs: 2001 }).success).toBe(false);
    expect(TrainRequest.safeParse({ train_windows: [1], lr: 0 }).success).toBe(false);
    expect(TrainRequest.safeParse({ train_windows: [1], lr: 1.5 }).success).toBe(false);
  });
  it("exclude_k0 jest opcjonalne, przyjmuje boolean (mapuje na excludeK0 zadania train)", () => {
    expect(TrainRequest.parse({ train_windows: [1] }).exclude_k0).toBeUndefined();
    expect(TrainRequest.parse({ train_windows: [1], exclude_k0: true }).exclude_k0).toBe(true);
    expect(TrainRequest.safeParse({ train_windows: [1], exclude_k0: "yes" }).success).toBe(false);
  });
});
