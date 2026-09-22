/**
 * Jedna iteracja pollera (spec §4, §8): (leniwie) katalog par, parametry modeli odświeżane co
 * `modelsRefreshMs`, próbka z RPC, zapis do `LiveStore`. Każdy błąd (baza, RPC, dekodowanie)
 * kończy się `store.fail(msg)` i `{ ok: false }` — poller (`@dex-arb/api`) tylko planuje
 * kolejne wywołanie i loguje zmianę stanu; nigdy nie dostaje wyjątku.
 */
import type { LiveTickResult } from "@dex-arb/shared";
import type { LiveRpc } from "./rpcTypes.js";
import { sampleLive, type LivePair } from "./sample.js";
import { defaultLiveModels, type LiveModels } from "./score.js";
import type { LiveStore } from "./store.js";

export interface LiveRuntimeDeps {
  rpc: LiveRpc;
  store: LiveStore;
  loadPairs: () => Promise<LivePair[]>;
  loadModels: () => Promise<LiveModels>;
  modelsRefreshMs: number;
  now?: () => Date;
  log?: (msg: string) => void;
}

export interface LiveRuntime {
  store: LiveStore;
  tick(): Promise<LiveTickResult>;
}

export function createLiveRuntime(deps: LiveRuntimeDeps): LiveRuntime {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  let pairs: LivePair[] | null = null;
  let models: LiveModels = defaultLiveModels();
  let modelsLoadedAt: number | null = null;

  async function tick(): Promise<LiveTickResult> {
    try {
      if (!pairs) pairs = await deps.loadPairs();
      const t = now().getTime();
      if (modelsLoadedAt === null || t - modelsLoadedAt >= deps.modelsRefreshMs) {
        models = await deps.loadModels();
        modelsLoadedAt = t;
      }
      const sample = await sampleLive(deps.rpc, pairs, { now, log });
      deps.store.record(sample, models);
      return { ok: true, block: sample.block };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      deps.store.fail(error);
      return { ok: false, error };
    }
  }

  return { store: deps.store, tick };
}
