// Test integracyjny handlera ingest:pool-window na realnym Postgresie z mockowanym RPC.
// Uruchomienie: DATABASE_URL_TEST=postgres://dexarb:dexarb@localhost:5433/dexarb_test npx vitest run packages/ingest
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { eq } from "drizzle-orm";
import type { JobContext } from "@dex-arb/shared";
import { HAS_DB, resetDb } from "./helpers/db.js";
import { makeIngestPoolWindow } from "../src/jobs/ingest-pool-window.js";
import { PAIR_IFACE } from "../src/decode.js";

// T0 = fromTs okna z fixture resetDb ("2021-05-14T00:00:00Z", w sekundach) — blok n ma timestamp T0 + n - 1000.
const T0 = 1_620_950_400;

function mockRpc(opts: { failLogsOnce?: boolean } = {}) {
  let failed = false;
  const logsFor = (from: number, to: number) => {
    const out = [];
    for (let b = from; b <= to; b += 10) {
      // co 10 bloków: Sync + Swap w jednej tx
      const tx = "0x" + b.toString(16).padStart(64, "0");
      const s = PAIR_IFACE.encodeEventLog("Sync", [BigInt(b) * 1000n, 5n]);
      const w = PAIR_IFACE.encodeEventLog("Swap", [
        "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
        1n,
        0n,
        0n,
        2n,
        "0x1111111111111111111111111111111111111111",
      ]);
      out.push({
        address: "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc",
        topics: s.topics,
        data: s.data,
        blockNumber: "0x" + b.toString(16),
        logIndex: "0x0",
        transactionHash: tx,
      });
      out.push({
        address: "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc",
        topics: w.topics,
        data: w.data,
        blockNumber: "0x" + b.toString(16),
        logIndex: "0x1",
        transactionHash: tx,
      });
    }
    return out;
  };
  const blockOf = (n: number) => ({
    number: "0x" + n.toString(16),
    timestamp: "0x" + (T0 + n - 1000).toString(16),
    transactions: [
      { hash: "0x" + n.toString(16).padStart(64, "0"), gasPrice: "0x" + (n * 7).toString(16) },
      { hash: "0xother", gasPrice: "0x1" },
    ],
  });
  const call = vi.fn(async (m: string, p: unknown[]) => {
    if (m === "eth_blockNumber") return "0x" + (5000).toString(16);
    if (m === "eth_getBlockByNumber") return blockOf(Number(BigInt(p[0] as string)));
    if (m === "eth_getLogs") {
      if (opts.failLogsOnce && !failed) {
        failed = true;
        throw new Error("awaria RPC");
      }
      const range = p[0] as { fromBlock: string; toBlock: string };
      return logsFor(Number(BigInt(range.fromBlock)), Number(BigInt(range.toBlock)));
    }
    throw new Error("nieoczekiwana metoda " + m);
  });
  const batch = vi.fn(async (reqs: { method: string; params: unknown[] }[]) =>
    reqs.map((r) => blockOf(Number(BigInt(r.params[0] as string)))),
  );
  return { call, batch, resetToPrimary: vi.fn() };
}

function ctx(): JobContext & { logs: string[]; progresses: number[] } {
  const c = {
    jobId: 1,
    logs: [] as string[],
    progresses: [] as number[],
    signal: new AbortController().signal,
    async log(m: string) {
      c.logs.push(m);
    },
    async progress(p: number) {
      c.progresses.push(p);
    },
  };
  return c;
}

describe.skipIf(!HAS_DB)("ingest:pool-window", () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let poolId: number, windowId: number;
  const env = { rpcUrls: ["mock"], rpcConcurrency: 2, logsChunkBlocks: 100 };

  beforeAll(() => {
    const conn = createTestDb();
    db = conn.db;
    closeDb = () => conn.sql.end();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    ({ poolId, windowId } = await resetDb(db));
    // okno: fromTs=T0 → blok 1000; toTs = T0 + 250 → blok 1250 (wyłącznie) → toBlock 1249
    await db.update(schema.windows).set({ toTs: new Date((T0 + 250) * 1000) }).where(eq(schema.windows.id, windowId));
  });

  it("wyznacza bloki okna, pobiera chunki, backfilluje bloki i gas_price; idempotentne", async () => {
    const rpc = mockRpc();
    const c = ctx();
    await makeIngestPoolWindow({ db, rpc, env })({ poolId, windowId }, c);

    const [w] = await db.select().from(schema.windows).where(eq(schema.windows.id, windowId));
    expect([w!.fromBlock, w!.toBlock]).toEqual([1000, 1249]);
    const ranges = await db.select().from(schema.ingestRanges);
    expect(ranges.map((r) => [r.fromBlock, r.toBlock, r.status])).toEqual([
      [1000, 1099, "done"],
      [1100, 1199, "done"],
      [1200, 1249, "done"],
    ]);
    expect((await db.select().from(schema.syncEvents)).length).toBe(25);
    const swaps = await db.select().from(schema.swapEvents);
    expect(swaps.length).toBe(25);
    expect(swaps.every((s) => s.gasPrice !== null && s.amount1Out === "2")).toBe(true);
    const blocks = await db.select().from(schema.blocks);
    expect(blocks.length).toBe(25);
    expect(blocks.find((b) => b.number === 1000)?.gasPriceMedian).toBe(String(Math.floor((7000 + 1) / 2)));
    expect(c.progresses.at(-1)).toBe(1);
    expect(c.progresses.every((p, i) => i === 0 || p >= c.progresses[i - 1]!)).toBe(true);
    expect(rpc.batch.mock.calls.every((call) => (call[0] as unknown[]).length <= 20)).toBe(true);

    // drugie uruchomienie: nic do pobrania (idempotentne)
    const rpc2 = mockRpc();
    await makeIngestPoolWindow({ db, rpc: rpc2, env })({ poolId, windowId }, ctx());
    expect(rpc2.call.mock.calls.filter(([m]) => m === "eth_getLogs").length).toBe(0);
    expect(rpc2.batch).not.toHaveBeenCalled();
  });

  it("błąd chunka → range failed, wyjątek; restart dokańcza tylko brakujące", async () => {
    await expect(
      makeIngestPoolWindow({ db, rpc: mockRpc({ failLogsOnce: true }), env })({ poolId, windowId }, ctx()),
    ).rejects.toThrow(/awaria RPC/);
    const failed = await db.select().from(schema.ingestRanges).where(eq(schema.ingestRanges.status, "failed"));
    expect(failed.length).toBe(1);
    expect(failed[0]!.error).toMatch(/awaria RPC/);
    // Pierwszy chunk pending zawiódł natychmiast (rethrow) — pozostałe 2 chunki nigdy nie były
    // próbowane, więc zostają "pending"; po restarcie WSZYSTKIE 3 (failed + 2 pending) trzeba pobrać.
    const stillPending = await db.select().from(schema.ingestRanges).where(eq(schema.ingestRanges.status, "pending"));
    expect(stillPending.length).toBe(2);

    const rpc = mockRpc();
    await makeIngestPoolWindow({ db, rpc, env })({ poolId, windowId }, ctx());
    expect(rpc.call.mock.calls.filter(([m]) => m === "eth_getLogs").length).toBe(3);
    expect((await db.select().from(schema.ingestRanges).where(eq(schema.ingestRanges.status, "done"))).length).toBe(3);
  });
});
