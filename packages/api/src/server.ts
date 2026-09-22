// Proces API: łączy się z bazą przez `createDb()` (DATABASE_URL) i startuje Fastify na porcie
// z env PORT (domyślnie 3001). Uruchomienie: `npm run dev -w @dex-arb/api`
// (skrypt ładuje ../../.env przez `tsx --env-file`).
//
// Panel „Na żywo" (spec 2026-08-27-live-panel-design.md §2, §8): tylko tutaj (nie w app.ts —
// testy aplikacji nie odpalają RPC) składamy RpcClient (wyłącznie RPC_URL, bez publicznych
// fallbacków — adres eRPC użytkownika; timeout HTTP LIVE_RPC_TIMEOUT_MS przez AbortSignal),
// LiveStore i runtime z @dex-arb/analysis oraz poller; `LIVE_ENABLED=false` (albo brak RPC_URL)
// wyłącza wszystko, a GET /live odpowiada `enabled: false`.
import { createDb } from "@dex-arb/db";
import { RpcClient } from "@dex-arb/ingest";
import { LiveStore, createLiveRuntime, loadLiveModels, loadLivePairs } from "@dex-arb/analysis";
import { LIVE_RPC_TIMEOUT_MS } from "@dex-arb/shared";
import { buildApp } from "./app.js";
import { loadLiveEnv } from "./live/env.js";
import { startLivePoller } from "./live/poller.js";

const { db, sql } = createDb();
const liveEnv = loadLiveEnv();
const store = liveEnv.enabled ? new LiveStore(liveEnv.history) : null;
// `sql` przekazany do buildApp rejestruje hook `onClose` — `app.close()` sam zamyka połączenie
// z bazą, więc graceful shutdown poniżej wystarczy wywołać raz.
const app = buildApp({ db, sql, logger: true, ...(store ? { live: store } : {}) });
const port = Number(process.env.PORT ?? 3001);

if (store && liveEnv.rpcUrl) {
  const warn = (msg: string) => app.log.warn(msg);
  const rpc = new RpcClient({
    urls: [liveEnv.rpcUrl],
    maxTries: 2,
    baseDelayMs: 500,
    fetchFn: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(LIVE_RPC_TIMEOUT_MS) }),
    log: warn,
  });
  const runtime = createLiveRuntime({
    rpc,
    store,
    loadPairs: () => loadLivePairs(db, warn),
    loadModels: () => loadLiveModels(db, warn),
    modelsRefreshMs: liveEnv.modelsRefreshMs,
    log: warn,
  });
  const poller = startLivePoller({ tick: runtime.tick, pollMs: liveEnv.pollMs, log: app.log });
  app.addHook("onClose", async () => {
    poller.stop();
  });
  app.log.info({ pollMs: liveEnv.pollMs, history: liveEnv.history, modelsRefreshMs: liveEnv.modelsRefreshMs }, "live: poller uruchomiony");
} else {
  app.log.info("live: wyłączone (LIVE_ENABLED=false albo brak RPC_URL) — GET /live zwraca enabled=false");
}

app.listen({ port, host: "127.0.0.1" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "Zamykanie serwera...");
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err, "Błąd podczas zamykania serwera");
    process.exit(1);
  }
}

process.on("SIGINT", (signal) => void shutdown(signal));
process.on("SIGTERM", (signal) => void shutdown(signal));
