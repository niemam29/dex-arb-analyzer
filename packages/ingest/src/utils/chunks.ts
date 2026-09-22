export interface BlockRange {
  fromBlock: number;
  toBlock: number;
}

export function planChunks(fromBlock: number, toBlock: number, size: number): BlockRange[] {
  if (size <= 0) throw new Error("size musi być > 0");
  const out: BlockRange[] = [];
  for (let from = fromBlock; from <= toBlock; from += size) {
    out.push({ fromBlock: from, toBlock: Math.min(from + size - 1, toBlock) });
  }
  return out;
}
