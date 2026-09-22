import { describe, it, expect } from "vitest";
import { parseJobParams, JOB_TYPES } from "../src/jobs.js";

describe("parseJobParams", () => {
  it("akceptuje poprawne parametry", () => {
    expect(parseJobParams("ingest:pool-window", { poolId: 1, windowId: 2 })).toEqual({ poolId: 1, windowId: 2 });
    expect(parseJobParams("import:csv", { path: "x.csv", poolAliases: { uniswap: 1, sushiswap: 2 } }))
      .toEqual({ path: "x.csv", poolAliases: { uniswap: 1, sushiswap: 2 } });
  });
  it("odrzuca złe parametry i nieznany typ", () => {
    expect(() => parseJobParams("ingest:pool-window", { poolId: "a" })).toThrow();
    expect(() => parseJobParams("nope", {})).toThrow(/Nieznany typ zadania/);
    expect(JOB_TYPES).toContain("import:csv");
  });
  it("zawiera wszystkie typy zadań; analyze:pair-window, verify:pair-window i train mają ścisłe schematy", () => {
    expect(JOB_TYPES).toEqual([
      "ingest:pool-window",
      "import:csv",
      "analyze:pair-window",
      "verify:pair-window",
      "train",
      "calibrate:baseline_v2",
    ]);
    expect(parseJobParams("analyze:pair-window", { pairId: 1, windowId: 2 })).toEqual({ pairId: 1, windowId: 2 });
    expect(() => parseJobParams("analyze:pair-window", { cokolwiek: 1 })).toThrow();
  });

  it("verify:pair-window: pairId/windowId wymagane, force opcjonalne", () => {
    expect(parseJobParams("verify:pair-window", { pairId: 1, windowId: 2 })).toEqual({ pairId: 1, windowId: 2 });
    expect(parseJobParams("verify:pair-window", { pairId: 1, windowId: 2, force: true })).toEqual({ pairId: 1, windowId: 2, force: true });
    expect(() => parseJobParams("verify:pair-window", {})).toThrow();
    expect(() => parseJobParams("verify:pair-window", { pairId: 1 })).toThrow();
    expect(() => parseJobParams("verify:pair-window", { pairId: 0, windowId: 1 })).toThrow();
  });

  it("calibrate:baseline_v2: trainWindows wymagane (≥1), testWindows domyślnie [], name opcjonalne", () => {
    expect(parseJobParams("calibrate:baseline_v2", { trainWindows: [2] })).toEqual({ trainWindows: [2], testWindows: [] });
    expect(parseJobParams("calibrate:baseline_v2", { trainWindows: [2], testWindows: [3], name: "bv2" })).toEqual({
      trainWindows: [2],
      testWindows: [3],
      name: "bv2",
    });
    expect(() => parseJobParams("calibrate:baseline_v2", { trainWindows: [] })).toThrow();
    expect(() => parseJobParams("calibrate:baseline_v2", {})).toThrow();
  });
  it("train: trainWindows wymagane (≥1), reszta ma sensowne domyślne", () => {
    expect(parseJobParams("train", { trainWindows: [1] })).toEqual({
      trainWindows: [1],
      testWindows: [],
      seed: 42,
      epochs: 200,
      lr: 0.01,
      excludeK0: false,
    });
    expect(
      parseJobParams("train", { trainWindows: [1, 2], testWindows: [3], name: "anfis-v2", seed: 7, epochs: 50, lr: 0.02, excludeK0: true }),
    ).toEqual({
      trainWindows: [1, 2],
      testWindows: [3],
      name: "anfis-v2",
      seed: 7,
      epochs: 50,
      lr: 0.02,
      excludeK0: true,
    });
    expect(() => parseJobParams("train", {})).toThrow();
    expect(() => parseJobParams("train", { trainWindows: [] })).toThrow();
    expect(() => parseJobParams("train", { trainWindows: [1], epochs: 0 })).toThrow();
    expect(() => parseJobParams("train", { trainWindows: [1], lr: 2 })).toThrow();
  });
});
