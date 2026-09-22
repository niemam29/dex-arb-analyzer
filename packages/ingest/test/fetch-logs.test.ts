import { describe, it, expect, vi } from "vitest";
import { fetchPoolLogs } from "../src/logs/fetch-logs.js";
import { PAIR_IFACE, TOPIC_SYNC, TOPIC_SWAP } from "../src/decode.js";
import { RpcError } from "../src/rpc/client.js";

const POOL = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc";
function syncLog(block: number, logIndex: number) {
  const enc = PAIR_IFACE.encodeEventLog("Sync", [BigInt(block), 1n]);
  return { address: POOL, topics: enc.topics, data: enc.data, blockNumber: "0x" + block.toString(16), logIndex: "0x" + logIndex.toString(16), transactionHash: "0xabc" };
}

describe("fetchPoolLogs", () => {
  it("woła eth_getLogs z adresem, zakresem hex i obydwoma topicami; dekoduje wynik", async () => {
    const call = vi.fn(async () => [syncLog(100, 1), syncLog(101, 0)]);
    const rpc = { call, batch: vi.fn() };
    const events = await fetchPoolLogs(rpc, POOL, { fromBlock: 100, toBlock: 199 });
    expect(call).toHaveBeenCalledWith("eth_getLogs", [{ address: POOL, fromBlock: "0x64", toBlock: "0xc7", topics: [[TOPIC_SYNC, TOPIC_SWAP]] }]);
    expect(events.map((e) => [e.block, e.logIndex])).toEqual([[100, 1], [101, 0]]);
  });

  it("odrzuca zduplikowany log (block, logIndex) zwrócony dwukrotnie przez RPC i sortuje wynik rosnąco", async () => {
    const call = vi.fn(async () => [syncLog(101, 0), syncLog(100, 1), syncLog(101, 0)]);
    const rpc = { call, batch: vi.fn() };
    const events = await fetchPoolLogs(rpc, POOL, { fromBlock: 100, toBlock: 199 });
    expect(events.map((e) => [e.block, e.logIndex])).toEqual([[100, 1], [101, 0]]);
  });

  it("na błąd limitu odpowiedzi dzieli zakres na pół", async () => {
    const call = vi.fn(async (_m: string, params: unknown[]) => {
      const f = params[0] as { fromBlock: string; toBlock: string };
      const from = Number(f.fromBlock), to = Number(f.toBlock);
      if (to - from > 49) throw new RpcError("RPC -32005: query returned more than 10000 results", true, undefined, -32005);
      return [syncLog(from, 0)];
    });
    const events = await fetchPoolLogs({ call, batch: vi.fn() }, POOL, { fromBlock: 0, toBlock: 99 });
    expect(events.map((e) => e.block)).toEqual([0, 50]);
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("rzuca, gdy RPC zwróci log spoza zakresu bloków albo z innego adresu (nie zapisuje cudzych danych)", async () => {
    const outOfRange = { ...syncLog(250, 0) };
    await expect(fetchPoolLogs({ call: vi.fn(async () => [syncLog(100, 1), outOfRange]), batch: vi.fn() }, POOL, { fromBlock: 100, toBlock: 199 })).rejects.toThrow(/spoza żądanego zakresu/);
    const otherAddress = { ...syncLog(150, 0), address: "0x" + "9".repeat(40) };
    await expect(fetchPoolLogs({ call: vi.fn(async () => [otherAddress]), batch: vi.fn() }, POOL, { fromBlock: 100, toBlock: 199 })).rejects.toThrow(/spoza żądanego zakresu\/adresu/);
  });
  it("adres puli porównywany bez uwzględniania wielkości liter", async () => {
    const lower = { ...syncLog(150, 0), address: POOL.toLowerCase() };
    await expect(fetchPoolLogs({ call: vi.fn(async () => [lower]), batch: vi.fn() }, POOL, { fromBlock: 100, toBlock: 199 })).resolves.toHaveLength(1);
  });
});
