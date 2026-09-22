import { describe, it, expect } from "vitest";
import { planChunks } from "../src/utils/chunks.js";
import { median, effectiveGasPrice } from "../src/utils/gas.js";
import { mapConcurrent } from "../src/utils/concurrency.js";

describe("planChunks", () => {
  it("dzieli zakres domknięty na chunki o rozmiarze size, ostatni krótszy", () => {
    expect(planChunks(100, 129, 10)).toEqual([
      { fromBlock: 100, toBlock: 109 }, { fromBlock: 110, toBlock: 119 }, { fromBlock: 120, toBlock: 129 },
    ]);
    expect(planChunks(100, 125, 10)).toEqual([
      { fromBlock: 100, toBlock: 109 }, { fromBlock: 110, toBlock: 119 }, { fromBlock: 120, toBlock: 125 },
    ]);
    expect(planChunks(5, 5, 10)).toEqual([{ fromBlock: 5, toBlock: 5 }]);
    expect(planChunks(10, 5, 10)).toEqual([]);
  });
});

describe("median", () => {
  it("nieparzysta / parzysta / pusta", () => {
    expect(median([5n, 1n, 3n])).toBe(3n);
    expect(median([4n, 1n, 3n, 2n])).toBe(2n);   // floor((2+3)/2)
    expect(median([])).toBeNull();
  });
});

describe("effectiveGasPrice", () => {
  it("legacy: gasPrice", () => {
    expect(effectiveGasPrice({ hash: "0x1", gasPrice: "0x3b9aca00" }, null)).toBe(1_000_000_000n);
  });
  it("EIP-1559: min(maxFee, base + priority)", () => {
    const tx = { hash: "0x1", type: "0x2", maxFeePerGas: "0x64", maxPriorityFeePerGas: "0x5", gasPrice: "0x1" };
    expect(effectiveGasPrice(tx, 10n)).toBe(15n);
    expect(effectiveGasPrice(tx, 200n)).toBe(100n);
  });
  it("brak danych → null", () => {
    expect(effectiveGasPrice({ hash: "0x1" }, null)).toBeNull();
  });

  // Dopełnienie pokrycia testowego (base_fee / effective gas price): brakujące przypadki
  // brzegowe dla implementacji w utils/gas.ts.
  it("tx typu 2 z baseFee bloku, ale bez maxFeePerGas/maxPriorityFeePerGas → spada do gasPrice (fallback, nie null/wyjątek)", () => {
    const tx = { hash: "0x1", type: "0x2", gasPrice: "0x3b9aca00" }; // 1 gwei, brak pól EIP-1559
    expect(effectiveGasPrice(tx, 10n)).toBe(1_000_000_000n);
  });

  it("tx typu 2: maxFee jest wiążącym ograniczeniem (min(maxFee, baseFee+priority) = maxFee)", () => {
    const tx = { hash: "0x1", type: "0x2", maxFeePerGas: "0x64", maxPriorityFeePerGas: "0x5" }; // 100, 5
    // baseFee=200 -> baseFee+priority=205 > maxFee=100 -> wynikiem jest maxFee
    expect(effectiveGasPrice(tx, 200n)).toBe(100n);
  });

  it("legacy tx (type 0) po Londynie (baseFee bloku podane) → nadal płaci gasPrice, nie min(...)", () => {
    const tx = { hash: "0x1", type: "0x0", gasPrice: "0x12a05f200" }; // 5 gwei
    expect(effectiveGasPrice(tx, 1_000_000_000n)).toBe(5_000_000_000n);
  });

  it("legacy tx bez pola type (undefined) po Londynie → traktowany jak type 0, płaci gasPrice", () => {
    const tx = { hash: "0x1", gasPrice: "0x77359400" }; // 2 gwei
    expect(effectiveGasPrice(tx, 1_000_000_000n)).toBe(2_000_000_000n);
  });
});

describe("mapConcurrent", () => {
  it("zachowuje kolejność i nie przekracza limitu", async () => {
    let active = 0, maxActive = 0;
    const out = await mapConcurrent([1, 2, 3, 4, 5], 2, async (x) => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--; return x * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(maxActive).toBe(2);
  });
});
