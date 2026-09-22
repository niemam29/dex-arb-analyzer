import { describe, it, expect, vi } from "vitest";
import { findBlockByTime, resolveWindowBlocks } from "../src/blocks/find-block.js";

const T0 = 1_600_000_000;
function mockRpc(latest = 1_000_000) {
  const call = vi.fn(async (method: string, params: unknown[]) => {
    if (method === "eth_blockNumber") return "0x" + latest.toString(16);
    if (method === "eth_getBlockByNumber") {
      const n = Number(BigInt(params[0] as string));
      return { number: params[0], timestamp: "0x" + (T0 + 13 * n).toString(16), transactions: [] };
    }
    throw new Error("nieoczekiwana metoda " + method);
  });
  return { call };
}

describe("findBlockByTime", () => {
  it("znajduje pierwszy blok z timestamp >= target", async () => {
    const rpc = mockRpc();
    expect(await findBlockByTime(rpc, T0 + 13 * 500, 0, 1000)).toBe(500);
    expect(await findBlockByTime(rpc, T0 + 13 * 500 + 1, 0, 1000)).toBe(501);
  });
  it("bez lo/hi używa eth_blockNumber i pobiera bloki bez pełnych tx", async () => {
    const rpc = mockRpc(4096);
    expect(await findBlockByTime(rpc, T0 + 13 * 77)).toBe(77);
    for (const [m, p] of rpc.call.mock.calls) if (m === "eth_getBlockByNumber") expect((p as unknown[])[1]).toBe(false);
    expect(rpc.call.mock.calls.filter(([m]) => m === "eth_getBlockByNumber").length).toBeLessThanOrEqual(13);
  });
  it("rzuca, gdy target wykracza poza timestamp ostatniego bloku (head)", async () => {
    const rpc = mockRpc(1000); // timestamp head-a = T0 + 13*1000
    await expect(findBlockByTime(rpc, T0 + 13 * 1000 + 1000)).rejects.toThrow(/okno wykracza poza ostatni blok/);
  });
  it("zwraca 0, gdy target jest sprzed bloku 0 (genesis)", async () => {
    const rpc = mockRpc(1000); // timestamp bloku 0 = T0
    expect(await findBlockByTime(rpc, T0 - 5000)).toBe(0);
  });
});

describe("resolveWindowBlocks", () => {
  it("zwraca [fromBlock, toBlock] dla okna [fromTs, toTs)", async () => {
    const rpc = mockRpc(10_000);
    expect(await resolveWindowBlocks(rpc, T0 + 13 * 100, T0 + 13 * 200)).toEqual({ fromBlock: 100, toBlock: 199 });
  });
  it("pobiera eth_blockNumber tylko raz (head współdzielony między oboma wyszukiwaniami)", async () => {
    const rpc = mockRpc(10_000);
    await resolveWindowBlocks(rpc, T0 + 13 * 100, T0 + 13 * 200);
    expect(rpc.call.mock.calls.filter(([m]) => m === "eth_blockNumber").length).toBe(1);
  });

  // Przypadek brzegowy: okno całkowicie za głową łańcucha (findBlockByTime dla fromTs
  // rzuca, bo nawet head ma ts < fromTs) musi propagować się z resolveWindowBlocks, nie zwracać
  // po cichu obcięty/błędny zakres.
  it("rzuca, gdy całe okno leży za head-em łańcucha (fromTs > timestamp ostatniego bloku)", async () => {
    const rpc = mockRpc(1000); // timestamp head-a (blok 1000) = T0 + 13*1000
    await expect(resolveWindowBlocks(rpc, T0 + 13 * 1000 + 1, T0 + 13 * 1000 + 1000)).rejects.toThrow(
      /okno wykracza poza ostatni blok/,
    );
  });

  it("resolveWindowBlocks: ostrzega przy rozbieżności z oczekiwanymi blokami, zwraca wynik z RPC; milczy przy zgodności", async () => {
    const rpc = { call: async (m: string, p: unknown[]) => (m === "eth_blockNumber" ? "0x64" : { timestamp: "0x" + (1000 + Number(p[0]) * 10).toString(16) }) };
    const warn = vi.fn();
    const r = await resolveWindowBlocks(rpc, 1100, 1200, { expected: { fromBlock: 10, toBlock: 19 }, warn });
    expect(r).toEqual({ fromBlock: 10, toBlock: 19 });
    expect(warn).not.toHaveBeenCalled();
    await resolveWindowBlocks(rpc, 1100, 1200, { expected: { fromBlock: 11, toBlock: 19 }, warn });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/10–19 różnią się od oczekiwanych 11–19/));
  });
});
