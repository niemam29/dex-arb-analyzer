import { describe, it, expect } from "vitest";
import { LiveSnapshotDto, LiveQuery, emptyLiveSnapshot, LIVE_MODEL_KEYS } from "../../src/dto/live.js";

const scores = { baseline: { score: 20, label: "wykonalna" }, mamdani: { score: 40, label: "ryzykowna" }, baseline_v2: null, anfis: null };
const pair = {
  pair_id: 1,
  symbol: "WETH/USDC",
  pool_a: { dex_name: "uniswap-v2", price: 2296.3 },
  pool_b: { dex_name: "sushiswap", price: 2319.57 },
  spread_pct: 1.0134,
  direction: "a_to_b",
  opt_trade_usd: 141015.29,
  gross_profit_usd: 287.54,
  net_profit_usd: 281.48,
  tvl_min_usd: 225856851.8,
  features: { s: 1.0134, g: 0.0121, l: 100, m: 50 },
  swaps_per_block: 0.15,
  scores,
};
const point = { at: "2026-08-27T10:00:00.000Z", block: 12488033, spread_pct: 1.0134, net_profit_usd: 281.48, scores };

describe("LiveSnapshotDto", () => {
  it("parsuje pełny snapshot z historią per para", () => {
    const r = LiveSnapshotDto.safeParse({
      at: "2026-08-27T10:00:00.000Z",
      block: 12488033,
      eth_usd: 2296.3,
      gas_gwei: 12,
      stale: false,
      consistent: true,
      error: null,
      enabled: true,
      pairs: [pair],
      history: { "1": [point] },
    });
    expect(r.success).toBe(true);
  });

  it("odrzuca nieznany kierunek i brak klucza modelu w scores", () => {
    expect(LiveSnapshotDto.safeParse({ ...emptyLiveSnapshot(true), pairs: [{ ...pair, direction: "up" }] }).success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { anfis: _a, ...noAnfis } = scores;
    expect(LiveSnapshotDto.safeParse({ ...emptyLiveSnapshot(true), pairs: [{ ...pair, scores: noAnfis }] }).success).toBe(false);
  });

  it("emptyLiveSnapshot: przed pierwszą próbką at/block/eth_usd/gas_gwei = null, stale=true, bez par", () => {
    const s = emptyLiveSnapshot(false);
    expect(s).toEqual({ at: null, block: null, eth_usd: null, gas_gwei: null, stale: true, consistent: true, error: null, enabled: false, pairs: [], history: {} });
    expect(LiveSnapshotDto.safeParse(s).success).toBe(true);
    expect(emptyLiveSnapshot(true).enabled).toBe(true);
  });

  it("LiveQuery odrzuca jakikolwiek parametr (strict)", () => {
    expect(LiveQuery.safeParse({}).success).toBe(true);
    expect(LiveQuery.safeParse({ pair: "1" }).success).toBe(false);
  });

  it("LIVE_MODEL_KEYS w kolejności baseline, mamdani, baseline_v2, anfis", () => {
    expect(LIVE_MODEL_KEYS).toEqual(["baseline", "mamdani", "baseline_v2", "anfis"]);
  });
});
