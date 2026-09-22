import { describe, it, expect } from "vitest";
import { createLiveRuntime } from "../../src/live/tick.js";
import { LiveStore } from "../../src/live/store.js";
import { defaultLiveModels, type LiveModels } from "../../src/live/score.js";
import { BaselineModel, BaselineV2Model } from "@dex-arb/core";
import { SUSHI_POOL, SUSHI_RESERVES_SPREAD_1PCT, UNI_POOL, UNI_RESERVES_12488033, WETH_USDC_PAIR, makeFakeRpc } from "./fixtures.js";
import type { LiveRpc, LiveRpcRequest } from "../../src/live/rpcTypes.js";

const bv2 = new BaselineV2Model({ gasUnits: 150000, arbGasRef: 220000, gasPriceFactor: 0.5, threshold: 0.42, weightOptTrade: 0, scale: 12.5, optTradeQuantiles: [0, 1, 2] });

function runtime(rpc: LiveRpc, opts: { models?: LiveModels[]; refreshMs?: number } = {}) {
  let t = 0;
  const now = () => new Date(1_756_290_000_000 + t);
  const loads = { pairs: 0, models: 0 };
  const queue = [...(opts.models ?? [defaultLiveModels()])];
  const store = new LiveStore(240);
  const rt = createLiveRuntime({
    rpc,
    store,
    loadPairs: async () => { loads.pairs++; return [WETH_USDC_PAIR]; },
    loadModels: async () => { loads.models++; return queue.length > 1 ? queue.shift()! : queue[0]!; },
    modelsRefreshMs: opts.refreshMs ?? 300_000,
    now,
  });
  return { rt, store, loads, advance: (ms: number) => { t += ms; } };
}

describe("createLiveRuntime", () => {
  it("tick: ładuje pary raz, modele przy starcie, zapisuje próbkę i zwraca ok z numerem bloku", async () => {
    const rpc = makeFakeRpc({ reserves: { [UNI_POOL]: UNI_RESERVES_12488033, [SUSHI_POOL]: SUSHI_RESERVES_SPREAD_1PCT } });
    const { rt, store, loads } = runtime(rpc);
    expect(await rt.tick()).toEqual({ ok: true, block: 12488033 });
    expect(await rt.tick()).toEqual({ ok: true, block: 12488033 });
    expect(loads).toEqual({ pairs: 1, models: 1 });
    const s = store.snapshot();
    expect(s.stale).toBe(false);
    expect(s.pairs[0]!.direction).toBe("a_to_b");
    expect(s.history["1"]).toHaveLength(2);
  });

  it("modele przeładowywane po modelsRefreshMs — nowy baseline_v2 pojawia się w ocenach", async () => {
    const rpc = makeFakeRpc({ reserves: { [UNI_POOL]: UNI_RESERVES_12488033, [SUSHI_POOL]: SUSHI_RESERVES_SPREAD_1PCT } });
    const withV2: LiveModels = { baseline: new BaselineModel(), baselineV2: bv2, anfis: null };
    const { rt, store, loads, advance } = runtime(rpc, { models: [defaultLiveModels(), withV2], refreshMs: 60_000 });
    await rt.tick();
    expect(store.snapshot().pairs[0]!.scores.baseline_v2).toBeNull();
    advance(59_000);
    await rt.tick();
    expect(loads.models).toBe(1);
    advance(2_000);
    await rt.tick();
    expect(loads.models).toBe(2);
    expect(store.snapshot().pairs[0]!.scores.baseline_v2!.label).toBe("atrakcyjna");
  });

  it("błąd RPC: store.fail, wynik {ok:false}, poprzednia próbka zostaje; kolejny sukces czyści", async () => {
    let broken = false;
    const good = makeFakeRpc({ reserves: { [UNI_POOL]: UNI_RESERVES_12488033, [SUSHI_POOL]: SUSHI_RESERVES_SPREAD_1PCT } });
    const rpc: LiveRpc = { batch: <T>(reqs: LiveRpcRequest[]) => (broken ? Promise.reject(new Error("HTTP 429")) : good.batch<T>(reqs)) };
    const { rt, store } = runtime(rpc);
    await rt.tick();
    broken = true;
    expect(await rt.tick()).toEqual({ ok: false, error: "HTTP 429" });
    expect(store.snapshot()).toMatchObject({ stale: true, error: "HTTP 429", block: 12488033 });
    broken = false;
    expect((await rt.tick()).ok).toBe(true);
    expect(store.snapshot().stale).toBe(false);
  });

  it("błąd ładowania par -> {ok:false}, ponowna próba w kolejnym ticku", async () => {
    const rpc = makeFakeRpc({ reserves: { [UNI_POOL]: UNI_RESERVES_12488033, [SUSHI_POOL]: SUSHI_RESERVES_SPREAD_1PCT } });
    let fails = 1;
    const store = new LiveStore(240);
    const rt = createLiveRuntime({
      rpc, store, modelsRefreshMs: 300_000,
      loadPairs: async () => { if (fails-- > 0) throw new Error("baza niedostępna"); return [WETH_USDC_PAIR]; },
      loadModels: async () => defaultLiveModels(),
    });
    expect(await rt.tick()).toEqual({ ok: false, error: "baza niedostępna" });
    expect((await rt.tick()).ok).toBe(true);
  });
});
