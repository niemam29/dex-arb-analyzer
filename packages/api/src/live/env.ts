// Zmienne środowiskowe panelu na żywo (spec §8). Czytane w server.ts (nie w app.ts — testy
// aplikacji nie mogą zależeć od env). Wartości domyślne z @dex-arb/shared (LIVE_*_DEFAULT).
import { LIVE_HISTORY_DEFAULT, LIVE_MODELS_REFRESH_MS_DEFAULT, LIVE_POLL_MS_DEFAULT } from "@dex-arb/shared";

export interface LiveEnv {
  /** true tylko gdy jest RPC_URL i LIVE_ENABLED nie jest false/0 (domyślnie: obecność RPC_URL) */
  enabled: boolean;
  rpcUrl: string | null;
  pollMs: number;
  history: number;
  modelsRefreshMs: number;
}

const TRUE = new Set(["1", "true", "yes"]);
const FALSE = new Set(["0", "false", "no"]);

function positiveInt(v: string | undefined, fallback: number): number {
  if (v === undefined || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadLiveEnv(env: NodeJS.ProcessEnv = process.env): LiveEnv {
  const rpcUrl = env.RPC_URL?.trim() ? env.RPC_URL.trim() : null;
  const flag = env.LIVE_ENABLED?.trim().toLowerCase() ?? "";
  let enabled: boolean;
  if (flag === "") enabled = rpcUrl !== null;
  else if (FALSE.has(flag)) enabled = false;
  else enabled = TRUE.has(flag) && rpcUrl !== null;
  return {
    enabled,
    rpcUrl,
    pollMs: positiveInt(env.LIVE_POLL_MS, LIVE_POLL_MS_DEFAULT),
    history: positiveInt(env.LIVE_HISTORY, LIVE_HISTORY_DEFAULT),
    modelsRefreshMs: positiveInt(env.LIVE_MODELS_REFRESH_MS, LIVE_MODELS_REFRESH_MS_DEFAULT),
  };
}
