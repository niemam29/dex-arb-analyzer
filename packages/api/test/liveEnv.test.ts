// Konfiguracja pollera na żywo (spec §8): LIVE_ENABLED domyślnie true tylko z RPC_URL; liczby z
// wartościami domyślnymi z @dex-arb/shared; niepoprawne liczby -> domyślne.
import { describe, it, expect } from "vitest";
import { loadLiveEnv } from "../src/live/env.js";

describe("loadLiveEnv", () => {
  it("bez RPC_URL: wyłączone, rpcUrl null, wartości domyślne", () => {
    expect(loadLiveEnv({})).toEqual({ enabled: false, rpcUrl: null, pollMs: 15_000, history: 240, modelsRefreshMs: 300_000 });
  });

  it("z RPC_URL i bez LIVE_ENABLED: włączone", () => {
    const e = loadLiveEnv({ RPC_URL: "http://127.0.0.1:4000/main/evm/1" });
    expect(e.enabled).toBe(true);
    expect(e.rpcUrl).toBe("http://127.0.0.1:4000/main/evm/1");
  });

  it("LIVE_ENABLED=false / 0 wyłącza mimo RPC_URL; true/1/yes włącza; true bez RPC_URL -> wyłączone", () => {
    expect(loadLiveEnv({ RPC_URL: "http://x", LIVE_ENABLED: "false" }).enabled).toBe(false);
    expect(loadLiveEnv({ RPC_URL: "http://x", LIVE_ENABLED: "0" }).enabled).toBe(false);
    expect(loadLiveEnv({ RPC_URL: "http://x", LIVE_ENABLED: "TRUE" }).enabled).toBe(true);
    expect(loadLiveEnv({ RPC_URL: "http://x", LIVE_ENABLED: "1" }).enabled).toBe(true);
    expect(loadLiveEnv({ RPC_URL: "http://x", LIVE_ENABLED: "yes" }).enabled).toBe(true);
    expect(loadLiveEnv({ LIVE_ENABLED: "true" }).enabled).toBe(false);
  });

  it("LIVE_POLL_MS / LIVE_HISTORY / LIVE_MODELS_REFRESH_MS: liczby dodatnie, inaczej domyślne", () => {
    expect(loadLiveEnv({ LIVE_POLL_MS: "5000", LIVE_HISTORY: "60", LIVE_MODELS_REFRESH_MS: "1000" })).toMatchObject({ pollMs: 5000, history: 60, modelsRefreshMs: 1000 });
    expect(loadLiveEnv({ LIVE_POLL_MS: "abc", LIVE_HISTORY: "-3", LIVE_MODELS_REFRESH_MS: "" })).toMatchObject({ pollMs: 15_000, history: 240, modelsRefreshMs: 300_000 });
  });
});
