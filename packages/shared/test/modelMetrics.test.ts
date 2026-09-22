import { describe, expect, it } from "vitest";
import { AnfisMetricsReadSchema, AnfisMetricsSchema, BaselineV2MetricsReadSchema, ModelEvaluationSchema, ProvenanceSchema } from "../src/dto/modelMetrics.js";

const evaluation = {
  n: 10, positives: 3, threshold: 50,
  confusion: { tp: 2, fp: 1, fn: 1, tn: 6 },
  precision: 2 / 3, recall: 2 / 3, f1: 2 / 3, auc: 0.8,
  roc: [{ fpr: 0, tpr: 0, threshold: Infinity }, { fpr: 1, tpr: 1, threshold: 0 }],
  histogram: { edges: [0, 50, 100], positive: [1, 2], negative: [5, 2] },
};
const provenance = {
  gitSha: "0123456789abcdef0123456789abcdef01234567", nodeVersion: "v20.19.0",
  deps: { "@thi.ng/fuzzy": "2.1.144", "drizzle-orm": "0.45.2" }, rpcHost: "rpc.example.org",
  windows: [{ id: 2, fromBlock: 12429199, toBlock: 12506592, blockStates: 309548, opportunities: 2236, verified: 2236 }],
  durationMs: 61234, createdAt: "2026-08-28T10:00:00.000Z",
};

describe("ProvenanceSchema", () => {
  it("akceptuje pełny blok i rpcHost=null; odrzuca URL z hasłem jako rpcHost", () => {
    expect(ProvenanceSchema.parse(provenance)).toEqual(provenance);
    expect(ProvenanceSchema.parse({ ...provenance, rpcHost: null }).rpcHost).toBeNull();
    expect(ProvenanceSchema.safeParse({ ...provenance, rpcHost: "https://user:pw@host/path" }).success).toBe(false);
  });
});

describe("ModelEvaluationSchema", () => {
  it("auc null przy jednej klasie; roc.threshold może być Infinity (JSON: null → Infinity przez preprocess)", () => {
    expect(ModelEvaluationSchema.parse({ ...evaluation, auc: null }).auc).toBeNull();
    const fromJson = JSON.parse(JSON.stringify(evaluation));
    expect(ModelEvaluationSchema.parse(fromJson).roc[0]!.threshold).toBe(Infinity);
  });
});

describe("AnfisMetricsSchema (zapis) / AnfisMetricsReadSchema (odczyt)", () => {
  const full = {
    population_block_states: { train: evaluation, test: null },
    population_verified: { train: { ...evaluation, n: 3, positives: 2 }, test: null },
    history: [{ epoch: 1, trainLoss: 0.5, valLoss: 0.6, lr: 0.01 }], bestEpoch: 1,
    dataset: { nPos: 2, nNeg: 1, nBackground: 20, windows: [2], nSkippedUnknown: 0 },
    classWeights: { pos: 10, neg: 1 }, seed: 42, trainWindows: [2], testWindows: [],
    diagnostics: { groups: 3, zeroGasConsumers: 0, estProfitNegativeButProfitable: 0 }, nGroupsTrain: 23,
    provenance,
  };
  it("zapis wymaga provenance i obu populacji", () => {
    expect(AnfisMetricsSchema.parse(full)).toEqual(full);
    expect(AnfisMetricsSchema.safeParse({ ...full, provenance: undefined }).success).toBe(false);
    expect(AnfisMetricsSchema.safeParse({ ...full, population_verified: undefined }).success).toBe(false);
  });
  it("odczyt akceptuje stare wiersze (train/test na górze, bez provenance) i nowe", () => {
    const legacy = { train: { auc: 0.81, f1: 0.6 }, test: { auc: 0.77, f1: 0.55 }, history: full.history, classWeights: full.classWeights, trainWindows: [2] };
    const parsed = AnfisMetricsReadSchema.parse(legacy);
    expect(parsed.test?.auc).toBe(0.77);
    expect(parsed.population_verified).toBeUndefined();
    expect(AnfisMetricsReadSchema.parse(full).population_verified?.train.auc).toBe(0.8);
    expect(AnfisMetricsReadSchema.safeParse("nie obiekt").success).toBe(false);
  });
});

describe("BaselineV2MetricsReadSchema", () => {
  it("stary kształt (calibration/holdout/grid) parsuje się bez provenance", () => {
    const legacy = { population: "verified_opportunities", calibration: { n: 3, positives: 2, auc: 1, f1: 1, precision: 1, recall: 1, thresholdNetUsd: null }, holdout: null, grid: [], trainWindows: [2], testWindows: [] };
    expect(BaselineV2MetricsReadSchema.parse(legacy).calibration.auc).toBe(1);
  });
});
