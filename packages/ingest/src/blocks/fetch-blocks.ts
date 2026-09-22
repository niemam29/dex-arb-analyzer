// Pobieranie pełnych bloków (z transakcjami) w batchach JSON-RPC po BLOCK_BATCH_SIZE, ze
// współbieżnością — nigdy nie pobieramy transakcji pojedynczo (eth_getBlockByNumber(..., true)
// zwraca je razem z blokiem).
import type { RawBlock } from "../rpc/types.js";
import type { RpcLike } from "../logs/fetch-logs.js";
import type { BlockRow } from "../db/blocks.js";
import { mapConcurrent } from "../utils/concurrency.js";
import { effectiveGasPrice, median } from "../utils/gas.js";
import { hexToBigint, hexToNumber } from "../utils/hex.js";

export const BLOCK_BATCH_SIZE = 20;

export function toBlockRow(b: RawBlock): BlockRow {
  const baseFee = b.baseFeePerGas ? hexToBigint(b.baseFeePerGas) : null;
  const txGasPrice = new Map<string, bigint>();
  for (const tx of b.transactions) {
    const g = effectiveGasPrice(tx, baseFee);
    if (g !== null) txGasPrice.set(tx.hash, g);
  }
  return {
    number: hexToNumber(b.number), timestamp: hexToNumber(b.timestamp), baseFee,
    gasPriceMedian: median([...txGasPrice.values()]), txCount: b.transactions.length, txGasPrice,
  };
}

export async function fetchBlocks(rpc: RpcLike, numbers: number[], concurrency: number, onBatch?: (done: number, total: number) => void): Promise<BlockRow[]> {
  const batches: number[][] = [];
  for (let i = 0; i < numbers.length; i += BLOCK_BATCH_SIZE) batches.push(numbers.slice(i, i + BLOCK_BATCH_SIZE));
  let done = 0;
  const results = await mapConcurrent(batches, concurrency, async (nums) => {
    const raw = await rpc.batch<RawBlock | null>(nums.map((n) => ({ method: "eth_getBlockByNumber", params: ["0x" + n.toString(16), true] })));
    const rows = raw.map((b, i) => { if (!b) throw new Error(`Brak bloku ${nums[i]}`); return toBlockRow(b); });
    onBatch?.(++done, batches.length);
    return rows;
  });
  return results.flat();
}
