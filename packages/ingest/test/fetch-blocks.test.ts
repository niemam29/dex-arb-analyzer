import { describe, it, expect, vi } from "vitest";
import { fetchBlocks, BLOCK_BATCH_SIZE } from "../src/blocks/fetch-blocks.js";

function block(n: number, gasPrices: number[]) {
  return {
    number: "0x" + n.toString(16), timestamp: "0x" + (1_600_000_000 + n).toString(16),
    transactions: gasPrices.map((g, i) => ({ hash: `0x${n}_${i}`, gasPrice: "0x" + g.toString(16) })),
  };
}

describe("fetchBlocks", () => {
  it("dzieli na batche po 20, mapuje wynik i liczy medianę gazu", async () => {
    const batchSizes: number[] = [];
    const batch = vi.fn(async (reqs: { method: string; params: unknown[] }[]) => {
      batchSizes.push(reqs.length);
      expect(reqs.every((r) => r.method === "eth_getBlockByNumber" && r.params[1] === true)).toBe(true);
      return reqs.map((r) => block(Number(BigInt(r.params[0] as string)), [5, 1, 3]));
    });
    const numbers = Array.from({ length: 45 }, (_, i) => 1000 + i);
    const rows = await fetchBlocks({ call: vi.fn(), batch }, numbers, 4);
    expect(batchSizes).toEqual([BLOCK_BATCH_SIZE, BLOCK_BATCH_SIZE, 5]);
    expect(rows.length).toBe(45);
    expect(rows[0]).toMatchObject({ number: 1000, timestamp: 1_600_001_000, baseFee: null, gasPriceMedian: 3n, txCount: 3 });
    expect(rows[0].txGasPrice.get("0x1000_0")).toBe(5n);
  });

  it("blok bez tx → mediana null, txCount 0; baseFee z bloku EIP-1559", async () => {
    const batch = vi.fn(async () => [{ ...block(7, []), baseFeePerGas: "0xa" }]);
    const [row] = await fetchBlocks({ call: vi.fn(), batch }, [7], 1);
    expect(row).toMatchObject({ gasPriceMedian: null, txCount: 0, baseFee: 10n });
  });

  it("brak bloku w odpowiedzi → błąd", async () => {
    const batch = vi.fn(async () => [null]);
    await expect(fetchBlocks({ call: vi.fn(), batch }, [7], 1)).rejects.toThrow(/Brak bloku 7/);
  });
});
