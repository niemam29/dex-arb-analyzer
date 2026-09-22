import { describe, it, expect } from "vitest";
import { PAIR_IFACE, TOPIC_SYNC, TOPIC_SWAP, decodeLog } from "../src/decode.js";
import type { RawLog } from "../src/rpc/types.js";

const POOL = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc";
const TX = "0x7a6f0482e2de7d67f3d93fae464bf10214dd945f2326d1cb1c318347c840ec8a";

function rawLog(topics: string[], data: string, logIndex: string): RawLog {
  return { address: POOL, topics, data, blockNumber: "0xbda790", logIndex, transactionHash: TX };
}

describe("decodeLog", () => {
  it("ma poprawne hashe topiców", () => {
    expect(TOPIC_SYNC).toBe("0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1");
    expect(TOPIC_SWAP).toBe("0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822");
  });

  it("dekoduje Sync (pierwszy wiersz data/events.csv z projektu)", () => {
    const enc = PAIR_IFACE.encodeEventLog("Sync", [163737114053377n, 44004147832345236861057n]);
    const ev = decodeLog(rawLog(enc.topics, enc.data, "0x84"));
    expect(ev).toEqual({ kind: "sync", block: 12429200, logIndex: 132, txHash: TX, reserve0: 163737114053377n, reserve1: 44004147832345236861057n });
  });

  it("dekoduje Swap z sender/to i czterema kwotami; sender/to zapisywane małymi literami (konwencja repo)", () => {
    const sender = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
    const to = "0x1111111111111111111111111111111111111111";
    const enc = PAIR_IFACE.encodeEventLog("Swap", [sender, 4624780000n, 0n, 0n, 1242000000000000000n, to]);
    const ev = decodeLog(rawLog(enc.topics, enc.data, "0x85"));
    expect(ev).toEqual({ kind: "swap", block: 12429200, logIndex: 133, txHash: TX, sender: sender.toLowerCase(), to: to.toLowerCase(),
      amount0In: 4624780000n, amount1In: 0n, amount0Out: 0n, amount1Out: 1242000000000000000n });
    expect((ev as { sender: string }).sender).toBe(sender.toLowerCase());
    expect((ev as { sender: string }).sender).not.toMatch(/[A-F]/);
  });

  it("zwraca null dla innych zdarzeń (Transfer) i logów removed", () => {
    const transfer = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    expect(decodeLog(rawLog([transfer], "0x", "0x1"))).toBeNull();
    const enc = PAIR_IFACE.encodeEventLog("Sync", [1n, 1n]);
    expect(decodeLog({ ...rawLog(enc.topics, enc.data, "0x1"), removed: true })).toBeNull();
  });
});
