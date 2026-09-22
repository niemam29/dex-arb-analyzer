// Rejestr handlerów workera: każdy typ z JOB_TYPES ma handler. Konfiguracja RPC jest
// WSTRZYKIWANA (nie czytana z process.env), więc test nie wymaga `.env` ani RPC_URL.
import { describe, expect, it } from "vitest";
import type { Db } from "@dex-arb/db";
import { JOB_TYPES } from "@dex-arb/shared";
import { buildHandlers } from "../src/handlers.js";

const env = { rpcUrls: ["http://127.0.0.1:1"], rpcConcurrency: 1, logsChunkBlocks: 100 };

describe("buildHandlers", () => {
  it("rejestruje handler dla każdego typu zadania z JOB_TYPES, bez czytania process.env", () => {
    const saved = process.env.RPC_URL;
    delete process.env.RPC_URL;
    try {
      const handlers = buildHandlers({} as Db, env);
      for (const type of JOB_TYPES) expect(handlers[type], type).toBeTypeOf("function");
    } finally {
      if (saved !== undefined) process.env.RPC_URL = saved;
    }
  });
});
