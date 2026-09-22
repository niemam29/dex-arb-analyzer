import { describe, it, expect } from "vitest";
import { LiveStore, RingBuffer } from "../../src/live/store.js";
import { defaultLiveModels } from "../../src/live/score.js";
import type { LiveSample, LivePairSample } from "../../src/live/sample.js";

const pairSample = (over: Partial<LivePairSample> = {}): LivePairSample => ({
  pairId: 1,
  symbol: "WETH/USDC",
  poolA: { dexName: "uniswap-v2", price: 2296.3, reserveBase: 0n, reserveQuote: 0n, tvlQuote: 225856851.8 },
  poolB: { dexName: "sushiswap", price: 2319.57, reserveBase: 0n, reserveQuote: 0n, tvlQuote: 356600000 },
  spreadPct: 1.0134039328042361,
  direction: "a_to_b",
  optTradeUsd: 141015.294741,
  grossProfitUsd: 287.542061,
  netProfitUsd: 281.4798279038842,
  tvlMinUsd: 225856851.796122,
  ethUsd: 2296.3004151953796,
  swapsPerBlock: 0.15,
  ...over,
});

const sample = (i: number, over: Partial<LiveSample> = {}): LiveSample => ({
  at: new Date(Date.UTC(2026, 7, 27, 10, 0, 15 * i)).toISOString(),
  block: 23000000 + i,
  blockTimestamp: 1_790_000_000 + 12 * i,
  baseFeeGwei: 10,
  gasGwei: 12,
  ethUsd: 2296.3004151953796,
  consistent: true,
  pairs: [pairSample()],
  ...over,
});

describe("RingBuffer", () => {
  it("nadpisuje najstarsze elementy po przekroczeniu pojemności, toArray w kolejności wstawiania", () => {
    const r = new RingBuffer<number>(3);
    [1, 2, 3, 4, 5].forEach((x) => r.push(x));
    expect(r.toArray()).toEqual([3, 4, 5]);
    expect(r.size).toBe(3);
    expect(new RingBuffer<number>(2).toArray()).toEqual([]);
  });
});

describe("LiveStore", () => {
  it("snapshot przed pierwszą próbką: stale=true, brak par, enabled=true", () => {
    const s = new LiveStore(240).snapshot();
    expect(s).toMatchObject({ at: null, block: null, stale: true, error: null, enabled: true, pairs: [], history: {} });
  });

  it("record: pary z cechami i ocenami, historia per para, M=50 dopóki < 10 próbek", () => {
    const store = new LiveStore(240);
    const snap = store.record(sample(0), defaultLiveModels());
    expect(snap.at).toBe("2026-08-27T10:00:00.000Z");
    expect(snap.block).toBe(23000000);
    expect(snap.eth_usd).toBeCloseTo(2296.3004, 3);
    expect(snap.gas_gwei).toBe(12);
    expect(snap.stale).toBe(false);
    expect(snap.consistent).toBe(true);
    const p = snap.pairs[0]!;
    expect(p).toMatchObject({ pair_id: 1, symbol: "WETH/USDC", direction: "a_to_b", swaps_per_block: 0.15 });
    expect(p.pool_a).toEqual({ dex_name: "uniswap-v2", price: 2296.3 });
    expect(p.features.s).toBeCloseTo(1.0134, 4);
    expect(p.features.m).toBe(50);
    expect(p.scores.baseline!.label).toBe("wykonalna");
    expect(p.scores.mamdani!.label).toBe("ryzykowna");
    expect(p.scores.baseline_v2).toBeNull();
    expect(snap.history["1"]).toHaveLength(1);
    expect(snap.history["1"]![0]).toMatchObject({ at: snap.at, block: 23000000, spread_pct: p.spread_pct, net_profit_usd: p.net_profit_usd });
  });

  it("po ≥ 10 próbkach M liczone z historii bufora (bieżąca próbka wliczona)", () => {
    const store = new LiveStore(240);
    // swapy rosnące 1..10, gaz 10..19 → dziesiąta próbka jest maksimum obu -> M = 100
    for (let i = 1; i <= 10; i++) {
      store.record(sample(i, { gasGwei: 9 + i, pairs: [pairSample({ swapsPerBlock: i })] }), defaultLiveModels());
    }
    expect(store.snapshot().pairs[0]!.features.m).toBeCloseTo(100, 9);
    // jedenasta: swapy 3 i gaz 12 wśród 11 wartości (posortowane: ...,3,3,... / ...,12,12,...) ->
    // percentileRank liczy udział elementów ≤ x (core/features.ts), więc licznik = 4 (dwa wystąpienia
    // wartości, licząc bieżącą próbkę) -> 100·(0,5·4/11 + 0,5·4/11)
    store.record(sample(11, { gasGwei: 12, pairs: [pairSample({ swapsPerBlock: 3 })] }), defaultLiveModels());
    expect(store.snapshot().pairs[0]!.features.m).toBeCloseTo((100 * (4 / 11 + 4 / 11)) / 2, 9);
  });

  it("historia ograniczona pojemnością; kolejność chronologiczna", () => {
    const store = new LiveStore(3);
    for (let i = 0; i < 5; i++) store.record(sample(i), defaultLiveModels());
    expect(store.snapshot().history["1"]!.map((p) => p.block)).toEqual([23000002, 23000003, 23000004]);
  });

  it("fail: stale=true + error, latest i historia bez zmian; kolejny record czyści błąd", () => {
    const store = new LiveStore(240);
    store.record(sample(0), defaultLiveModels());
    store.fail("RPC 429: " + "x".repeat(500));
    const s = store.snapshot();
    expect(s.stale).toBe(true);
    expect(s.error!.length).toBeLessThanOrEqual(200);
    expect(s.error!.startsWith("RPC 429")).toBe(true);
    expect(s.at).toBe("2026-08-27T10:00:00.000Z");
    expect(s.pairs).toHaveLength(1);
    expect(s.history["1"]).toHaveLength(1);
    store.record(sample(1), defaultLiveModels());
    expect(store.snapshot()).toMatchObject({ stale: false, error: null, block: 23000001 });
  });

  it("consistent=false z próbki przenosi się do snapshotu", () => {
    const store = new LiveStore(240);
    store.record(sample(0, { consistent: false }), defaultLiveModels());
    expect(store.snapshot().consistent).toBe(false);
  });
});
