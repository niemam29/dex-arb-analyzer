import { describe, it, expect } from "vitest";
import { loadIngestEnv } from "../src/env.js";

describe("loadIngestEnv", () => {
  it("składa listę URL-i: RPC_URL + fallbacki, i domyślne liczby", () => {
    const e = loadIngestEnv({ RPC_URL: "http://erpc/main/evm/1", RPC_FALLBACK_URLS: "https://a, https://b" });
    expect(e.rpcUrls).toEqual(["http://erpc/main/evm/1", "https://a", "https://b"]);
    expect(e.rpcConcurrency).toBe(4);
    expect(e.logsChunkBlocks).toBe(10_000);
  });
  it("parsuje liczby z env", () => {
    const e = loadIngestEnv({ RPC_URL: "http://x", RPC_CONCURRENCY: "2", LOGS_CHUNK_BLOCKS: "2000" });
    expect(e.rpcConcurrency).toBe(2);
    expect(e.logsChunkBlocks).toBe(2000);
  });
  it("rzuca bez RPC_URL", () => {
    expect(() => loadIngestEnv({})).toThrow(/RPC_URL/);
  });
});
