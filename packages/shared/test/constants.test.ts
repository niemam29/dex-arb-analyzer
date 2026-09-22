import { describe, it, expect } from "vitest";
import {
  SPREAD_THRESHOLD_PCT,
  JOB_STATUSES,
  INGEST_RANGE_STATUSES,
  DIRECTION_KINDS,
  LABELS,
  REFERENCE_PAIR_SYMBOL,
  LIVE_POLL_MS_DEFAULT,
  LIVE_HISTORY_DEFAULT,
  LIVE_MODELS_REFRESH_MS_DEFAULT,
  LIVE_PRIORITY_GWEI,
  LIVE_SWAP_LOOKBACK_BLOCKS,
  LIVE_M_MIN_HISTORY,
  LIVE_M_NEUTRAL,
  LIVE_RPC_TIMEOUT_MS,
  LIVE_RECENT_ROWS,
} from "../src/constants.js";

describe("constants", () => {
  it("SPREAD_THRESHOLD_PCT = 0.65 (próg sumy prowizji 2×0,3 %)", () => {
    expect(SPREAD_THRESHOLD_PCT).toBe(0.65);
  });
  it("JOB_STATUSES odpowiada job_status DB enum — bez 'pending' (queued|running|done|failed)", () => {
    expect(JOB_STATUSES).toEqual(["queued", "running", "done", "failed"]);
  });
  it("INGEST_RANGE_STATUSES odpowiada ingest_status DB enum — inny zbiór niż job_status", () => {
    expect(INGEST_RANGE_STATUSES).toEqual(["pending", "done", "failed"]);
  });
  it("DIRECTION_KINDS i LABELS odpowiadają enumom direction_kind/feasibility_label", () => {
    expect(DIRECTION_KINDS).toEqual(["none", "a_to_b", "b_to_a"]);
    expect(LABELS).toEqual(["niewykonalna", "ryzykowna", "wykonalna", "atrakcyjna"]);
  });
  it("REFERENCE_PAIR_SYMBOL = WETH/USDC (współdzielona przez analysis i worker/matrix)", () => {
    expect(REFERENCE_PAIR_SYMBOL).toBe("WETH/USDC");
  });
  it("LIVE_*: wartości domyślne ze spec panelu na żywo (§2, §3, §8, §10)", () => {
    expect(LIVE_POLL_MS_DEFAULT).toBe(15_000);
    expect(LIVE_HISTORY_DEFAULT).toBe(240);
    expect(LIVE_MODELS_REFRESH_MS_DEFAULT).toBe(300_000);
    expect(LIVE_PRIORITY_GWEI).toBe(2);
    expect(LIVE_SWAP_LOOKBACK_BLOCKS).toBe(20);
    expect(LIVE_M_MIN_HISTORY).toBe(10);
    expect(LIVE_M_NEUTRAL).toBe(50);
    expect(LIVE_RPC_TIMEOUT_MS).toBe(10_000);
    expect(LIVE_RECENT_ROWS).toBe(20);
  });
});
