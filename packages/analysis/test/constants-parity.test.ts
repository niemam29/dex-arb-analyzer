// `@dex-arb/shared` i `@dex-arb/db` celowo nie zależą od `@dex-arb/core`, więc kilka stałych jest
// zduplikowanych jako literały. Ten test (w pakiecie zależnym od wszystkich) pilnuje równości.
import { expect, it } from "vitest";
import { BLOCK_CLUSTER_GAP_MAX as CORE_GAP, K_MAX, LIVE_PRIORITY_GWEI as CORE_PRIO, SPREAD_THRESHOLD_PCT as CORE_SPREAD } from "@dex-arb/core";
import { LIVE_PRIORITY_GWEI, SPREAD_THRESHOLD_PCT } from "@dex-arb/shared";
import { BLOCK_CLUSTER_GAP_MAX, OPPORTUNITY_THRESHOLD_PCT } from "../src/index.js";
import { K_MAX as VERIFY_K_MAX } from "../src/verify/classify.js";

it("stałe zduplikowane między pakietami są równe", () => {
  expect(SPREAD_THRESHOLD_PCT).toBe(CORE_SPREAD);
  expect(OPPORTUNITY_THRESHOLD_PCT).toBe(CORE_SPREAD);
  expect(LIVE_PRIORITY_GWEI).toBe(CORE_PRIO);
  expect(BLOCK_CLUSTER_GAP_MAX).toBe(CORE_GAP);
  expect(VERIFY_K_MAX).toBe(K_MAX);
});
