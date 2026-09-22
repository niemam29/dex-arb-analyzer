import type { RawTx } from "../rpc/types.js";

export function median(values: bigint[]): bigint | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2n;
}

export function effectiveGasPrice(tx: RawTx, baseFee: bigint | null): bigint | null {
  if (tx.type === "0x2" && baseFee !== null && tx.maxFeePerGas && tx.maxPriorityFeePerGas) {
    const maxFee = BigInt(tx.maxFeePerGas);
    const withPriority = baseFee + BigInt(tx.maxPriorityFeePerGas);
    return maxFee < withPriority ? maxFee : withPriority;
  }
  return tx.gasPrice ? BigInt(tx.gasPrice) : null;
}
