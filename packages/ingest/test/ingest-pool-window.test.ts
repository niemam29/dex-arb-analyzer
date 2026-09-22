// Test jednostkowy handlera ingest:pool-window z zamockowaną warstwą DB i RPC (bez Postgresa) —
// pokrywa: pomijanie zakresów "done", markRange "failed" + rethrow, monotoniczność progressu,
// przerwanie przez ctx.signal.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@dex-arb/db";
import type { JobContext } from "@dex-arb/shared";

vi.mock("../src/db/ranges.js", () => ({
  ensureRanges: vi.fn(async () => {}),
  listPendingRanges: vi.fn(),
  markRange: vi.fn(async () => {}),
}));
vi.mock("../src/db/events.js", () => ({
  insertEvents: vi.fn(async () => ({ sync: 0, swap: 0 })),
  blocksNeedingBackfill: vi.fn(async () => []),
}));
vi.mock("../src/db/blocks.js", () => ({
  upsertBlocks: vi.fn(async () => {}),
  updateSwapGasPrices: vi.fn(async () => 0),
}));
vi.mock("../src/blocks/find-block.js", () => ({
  resolveWindowBlocks: vi.fn(async () => ({ fromBlock: 1000, toBlock: 1199 })),
}));
vi.mock("../src/blocks/fetch-blocks.js", () => ({
  fetchBlocks: vi.fn(async () => []),
}));
vi.mock("../src/logs/fetch-logs.js", () => ({
  fetchPoolLogs: vi.fn(async () => []),
}));

const { ensureRanges, listPendingRanges, markRange } = await import("../src/db/ranges.js");
const { insertEvents, blocksNeedingBackfill } = await import("../src/db/events.js");
const { upsertBlocks, updateSwapGasPrices } = await import("../src/db/blocks.js");
const { resolveWindowBlocks } = await import("../src/blocks/find-block.js");
const { fetchBlocks } = await import("../src/blocks/fetch-blocks.js");
const { fetchPoolLogs } = await import("../src/logs/fetch-logs.js");
const { makeIngestPoolWindow } = await import("../src/jobs/ingest-pool-window.js");

const POOL = { id: 1, dexId: 1, pairId: 1, address: "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc", token0: "0xtoken0", token1: "0xtoken1" };
const WINDOW_RESOLVED = {
  id: 1,
  name: "test",
  fromTs: new Date("2021-05-14T00:00:00Z"),
  toTs: new Date("2021-05-14T00:33:20Z"),
  fromBlock: 1000,
  toBlock: 1199,
};

/** Fake minimalnego podzbioru API Db używanego bezpośrednio przez handler (reszta idzie przez db/*.ts, zamockowane wyżej). */
function fakeDb(opts: { pool?: typeof POOL | undefined; window?: typeof WINDOW_RESOLVED | undefined; onWindowUpdate?: (v: unknown) => void }) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          if (table === schema.pools) return opts.pool ? [opts.pool] : [];
          if (table === schema.windows) return opts.window ? [opts.window] : [];
          return [];
        },
      }),
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: async () => {
          opts.onWindowUpdate?.(values);
        },
      }),
    }),
    execute: async () => [{ sync: 0, swap: 0 }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function ctx(signal = new AbortController().signal): JobContext & { logs: string[]; progresses: number[] } {
  const c = {
    jobId: 1,
    logs: [] as string[],
    progresses: [] as number[],
    signal,
    async log(m: string) {
      c.logs.push(m);
    },
    async progress(p: number) {
      c.progresses.push(p);
    },
  };
  return c;
}

const rpc = { call: vi.fn(), batch: vi.fn(), resetToPrimary: vi.fn() };
const env = { rpcUrls: ["mock"], rpcConcurrency: 2, logsChunkBlocks: 100 };

describe("makeIngestPoolWindow (jednostkowo, zamockowane db/*)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWindowBlocks).mockResolvedValue({ fromBlock: 1000, toBlock: 1199 });
    vi.mocked(insertEvents).mockResolvedValue({ sync: 0, swap: 0 });
    vi.mocked(blocksNeedingBackfill).mockResolvedValue([]);
    vi.mocked(fetchPoolLogs).mockResolvedValue([]);
    vi.mocked(fetchBlocks).mockResolvedValue([]);
    vi.mocked(upsertBlocks).mockResolvedValue(undefined);
    vi.mocked(updateSwapGasPrices).mockResolvedValue(0);
    vi.mocked(markRange).mockResolvedValue(undefined);
    vi.mocked(ensureRanges).mockResolvedValue(undefined);
  });

  it("pomija zakresy 'done': listPendingRanges puste → brak wywołań fetchPoolLogs, progress kończy się na 1", async () => {
    vi.mocked(listPendingRanges).mockResolvedValue([]);
    const db = fakeDb({ pool: POOL, window: WINDOW_RESOLVED });
    const c = ctx();
    await makeIngestPoolWindow({ db, rpc, env })({ poolId: 1, windowId: 1 }, c);

    expect(fetchPoolLogs).not.toHaveBeenCalled();
    expect(resolveWindowBlocks).not.toHaveBeenCalled(); // bloki okna już wyznaczone (fromBlock/toBlock != null)
    expect(c.progresses.at(-1)).toBe(1);
  });

  it("błąd w fetchPoolLogs → markRange('failed', komunikat) i rethrow", async () => {
    const range = { fromBlock: 1000, toBlock: 1099 };
    vi.mocked(listPendingRanges).mockResolvedValue([range]);
    vi.mocked(fetchPoolLogs).mockRejectedValue(new Error("awaria RPC"));
    const db = fakeDb({ pool: POOL, window: WINDOW_RESOLVED });

    await expect(makeIngestPoolWindow({ db, rpc, env })({ poolId: 1, windowId: 1 }, ctx())).rejects.toThrow(/awaria RPC/);
    expect(markRange).toHaveBeenCalledWith(db, 1, range, "failed", expect.stringContaining("awaria RPC"));
  });

  it("progress jest monotoniczny i kończy się na 1 przy kilku zakresach i partiach backfillu", async () => {
    const ranges = [
      { fromBlock: 1000, toBlock: 1099 },
      { fromBlock: 1100, toBlock: 1199 },
    ];
    vi.mocked(listPendingRanges).mockResolvedValue(ranges);
    vi.mocked(blocksNeedingBackfill).mockResolvedValue([1000, 1001, 1002]);
    const db = fakeDb({ pool: POOL, window: WINDOW_RESOLVED });
    const c = ctx();
    await makeIngestPoolWindow({ db, rpc, env })({ poolId: 1, windowId: 1 }, c);

    expect(c.progresses.length).toBeGreaterThan(0);
    for (let i = 1; i < c.progresses.length; i++) expect(c.progresses[i]!).toBeGreaterThanOrEqual(c.progresses[i - 1]!);
    expect(c.progresses.at(-1)).toBe(1);
    expect(markRange).toHaveBeenCalledTimes(2);
    expect(markRange).toHaveBeenNthCalledWith(1, db, 1, ranges[0], "done");
    expect(markRange).toHaveBeenNthCalledWith(2, db, 1, ranges[1], "done");
  });

  it("przerwane (ctx.signal.aborted) między zakresami → rzuca i nie wywołuje kolejnego fetchPoolLogs", async () => {
    const ranges = [
      { fromBlock: 1000, toBlock: 1099 },
      { fromBlock: 1100, toBlock: 1199 },
    ];
    vi.mocked(listPendingRanges).mockResolvedValue(ranges);
    const ac = new AbortController();
    vi.mocked(fetchPoolLogs).mockImplementation(async () => {
      ac.abort(); // przerwanie następuje w trakcie przetwarzania pierwszego zakresu
      return [];
    });
    const db = fakeDb({ pool: POOL, window: WINDOW_RESOLVED });

    await expect(makeIngestPoolWindow({ db, rpc, env })({ poolId: 1, windowId: 1 }, ctx(ac.signal))).rejects.toThrow(/Przerwano/);
    expect(fetchPoolLogs).toHaveBeenCalledTimes(1); // drugi zakres nie jest już przetwarzany
  });

  it("wyznacza bloki okna, gdy window.fromBlock/toBlock są NULL, i persystuje wynik", async () => {
    vi.mocked(listPendingRanges).mockResolvedValue([]);
    const windowUnresolved = { ...WINDOW_RESOLVED, fromBlock: null, toBlock: null };
    const onWindowUpdate = vi.fn();
    const db = fakeDb({ pool: POOL, window: windowUnresolved, onWindowUpdate });

    await makeIngestPoolWindow({ db, rpc, env })({ poolId: 1, windowId: 1 }, ctx());

    expect(resolveWindowBlocks).toHaveBeenCalledTimes(1);
    expect(onWindowUpdate).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 1000, toBlock: 1199 }));
  });

  it("drugi z trzech chunków zawodzi: pierwszy 'done', drugi 'failed' (z komunikatem), trzeci nieprzetworzony, job rzuca", async () => {
    const ranges = [
      { fromBlock: 1000, toBlock: 1099 },
      { fromBlock: 1100, toBlock: 1199 },
      { fromBlock: 1200, toBlock: 1299 },
    ];
    vi.mocked(listPendingRanges).mockResolvedValue(ranges);
    vi.mocked(fetchPoolLogs).mockImplementation(async (_rpc, _addr, r) => {
      if (r.fromBlock === 1100) throw new Error("limit RPC");
      return [];
    });
    const db = fakeDb({ pool: POOL, window: WINDOW_RESOLVED });
    await expect(makeIngestPoolWindow({ db, rpc, env })({ poolId: 1, windowId: 1 }, ctx())).rejects.toThrow(/limit RPC/);
    expect(markRange).toHaveBeenCalledTimes(2);
    expect(markRange).toHaveBeenNthCalledWith(1, db, 1, ranges[0], "done");
    expect(markRange).toHaveBeenNthCalledWith(2, db, 1, ranges[1], "failed", expect.stringContaining("limit RPC"));
    expect(fetchPoolLogs).toHaveBeenCalledTimes(2); // trzeci chunk nie jest pobierany
    expect(blocksNeedingBackfill).not.toHaveBeenCalled(); // backfill nie startuje po awarii
  });
});
