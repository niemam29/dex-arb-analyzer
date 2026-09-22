// @dex-arb/core — matematyka AMM, cechy S/G/L/M, modele baseline/mamdani/anfis, ewaluacja.
export * from "./types.js";
export * from "./constants.js";
export * from "./amm.js";
export * from "./orient.js";
export * from "./features.js";
export * from "./mamdani.params.js";
export * from "./baseline.js";
export * from "./baselineV2.js";
export * from "./evaluation.js";
export { buildMamdani, evaluateArbitrage, createMamdaniModel, MamdaniModel, labelForScore } from "./mamdani.js";
export type { Mamdani, CrispInputs, InferenceResult, RuleActivation } from "./mamdani.js";
export * from "./anfis/index.js";
