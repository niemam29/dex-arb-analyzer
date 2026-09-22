// GET /live (spec §6): snapshot z wstrzykniętego LiveStoreLike, zawsze 200 (stale też), enabled=false
// bez store, .strict() na query. Bez bazy i bez RPC — atrapa store zamiast LiveStore z analysis.
import { describe, it, expect, afterAll } from "vitest";
import type { Db } from "@dex-arb/db";
import { LiveSnapshotDto, emptyLiveSnapshot, type LiveSnapshotDto as Snapshot, type LiveStoreLike } from "@dex-arb/shared";
import { buildApp } from "../src/app.js";

const scores = { baseline: { score: 19.96, label: "wykonalna" }, mamdani: { score: 40, label: "ryzykowna" }, baseline_v2: null, anfis: { score: 91.4, label: "atrakcyjna" } };
const fullSnapshot: Snapshot = {
  at: "2026-08-27T10:00:00.000Z",
  block: 23000000,
  eth_usd: 2296.3,
  gas_gwei: 12,
  stale: false,
  consistent: true,
  error: null,
  enabled: true,
  pairs: [
    {
      pair_id: 1, symbol: "WETH/USDC",
      pool_a: { dex_name: "uniswap-v2", price: 2296.3 }, pool_b: { dex_name: "sushiswap", price: 2319.57 },
      spread_pct: 1.0134, direction: "a_to_b", opt_trade_usd: 141015.29, gross_profit_usd: 287.54, net_profit_usd: 281.48,
      tvl_min_usd: 225856851.8, features: { s: 1.0134, g: 0.0121, l: 100, m: 50 }, swaps_per_block: 0.15, scores,
    },
  ],
  history: { "1": [{ at: "2026-08-27T10:00:00.000Z", block: 23000000, spread_pct: 1.0134, net_profit_usd: 281.48, scores }] },
};

function storeOf(snapshot: Snapshot): LiveStoreLike {
  return { snapshot: () => snapshot };
}

describe("GET /live", () => {
  const apps: ReturnType<typeof buildApp>[] = [];
  const build = (live?: LiveStoreLike) => {
    const app = buildApp({ db: {} as Db, ...(live ? { live } : {}) });
    apps.push(app);
    return app;
  };
  afterAll(async () => {
    for (const a of apps) await a.close();
  });

  it("zwraca snapshot ze store (200, parsuje się LiveSnapshotDto)", async () => {
    const res = await build(storeOf(fullSnapshot)).inject({ method: "GET", url: "/live" });
    expect(res.statusCode).toBe(200);
    const body = LiveSnapshotDto.parse(res.json());
    expect(body).toEqual(fullSnapshot);
  });

  it("stale snapshot (błąd RPC) też daje 200 z error i ostatnią dobrą próbką", async () => {
    const stale = { ...fullSnapshot, stale: true, error: "HTTP 429" };
    const res = await build(storeOf(stale)).inject({ method: "GET", url: "/live" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ stale: true, error: "HTTP 429", block: 23000000 });
  });

  it("bez store (LIVE_ENABLED=false): 200 z enabled=false i pustymi parami", async () => {
    const res = await build().inject({ method: "GET", url: "/live" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(emptyLiveSnapshot(false));
  });

  it("parametr zapytania -> 400 (.strict())", async () => {
    const res = await build(storeOf(fullSnapshot)).inject({ method: "GET", url: "/live?pair=1" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "Niepoprawne dane wejściowe" });
  });

  it("store zwracający coś niezgodnego z DTO -> 500 (kontrola kontraktu wyjścia)", async () => {
    const res = await build({ snapshot: () => ({ ...fullSnapshot, pairs: [{ bad: true }] }) as unknown as Snapshot }).inject({ method: "GET", url: "/live" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Niezgodność kontraktu odpowiedzi" });
  });
});
