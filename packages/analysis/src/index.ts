// @dex-arb/analysis — stany bloków, okazje, weryfikacja retrospektywna, etykiety.
export { analyzePairWindow, type AnalyzeProgress, type AnalyzeResult } from "./analyzePairWindow.js";
export { OPPORTUNITY_THRESHOLD_PCT } from "./opportunities.js";
// Weryfikacja retrospektywna okazji — `@dex-arb/worker` importuje stąd
// `runVerifyPairWindow`/`createDrizzleVerifyRepo` (handler `verify:pair-window`).
export * from "./verify/index.js";
// Zbiór uczący ANFIS — `@dex-arb/worker` importuje stąd (handler `train`).
// filterK0/computeGroupKeys/BLOCK_CLUSTER_GAP_MAX: podział train/test grupowo świadomy (ADR 0007),
// opcjonalne wykluczenie k=0 — patrz komentarze w anfis/dataset.ts.
export {
  buildDataset,
  loadLabeledRows,
  toFeatures,
  filterK0,
  computeGroupKeys,
  isUnknownLabel,
  isVerifiedKnownOpportunity,
  BLOCK_CLUSTER_GAP_MAX,
  type LabeledRow,
  type DatasetOptions,
  type DatasetMeta,
  type Dataset,
} from "./anfis/dataset.js";
// `writeModelScores` — handler `train` zapisuje nim ocenę ANFIS do model_scores,
// tak samo jak `analyzePairWindow` dla baseline/mamdani (patrz db.ts).
export { writeModelScores, type ModelScoreRow } from "./db.js";
// Proweniencja wyników (git SHA, wersje, host RPC, liczności per okno) — `worker` zapisuje ją w
// `scoring_models.metrics` przy `train`/`calibrate:baseline_v2` (blok `provenance`).
export { collectProvenance } from "./provenance.js";
// Panel „Na żywo" (2026-08-27) — `@dex-arb/api` importuje stąd LiveStore/createLiveRuntime/loadLive*.
// `TOPIC_SWAP_V2` (live/rpcTypes.ts) re-eksportuje verify/route.ts (jedno źródło prawdy) — te same
// binding, więc kolizja `export *` z linią 6 nie występuje.
export * from "./live/index.js";
