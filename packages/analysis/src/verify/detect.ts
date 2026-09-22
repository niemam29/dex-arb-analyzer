/**
 * Detekcja atomowego arbitrażu (przeciwne kierunki w tej samej tx, obie pule) oraz
 * częściowej konsumpcji (pojedynczy swap zmniejszający spread) — czysta logika bez I/O.
 * Patrz sekcja "Definicje kluczowe" w planie etapu 4.
 */
import { toPairDirection } from "./direction.js";
import type { PairDirection, PairMeta, PoolMeta, SwapRow } from "./types.js";

export interface DetectContext {
  pools: [PoolMeta, PoolMeta];
  pair: PairMeta;
}

export interface AtomicCandidate {
  txHash: string;
  block: number;
  /** wszystkie swapy tej tx w obu pulach, posortowane wg logIndex */
  swaps: SwapRow[];
  buyPoolId: number;
  sellPoolId: number;
  /** wspólne `to` obu swapów, albo null gdy się różnią (wtedy trzeba sięgnąć po `from` z receiptu) */
  beneficiary: string | null;
}

const byLog = (a: SwapRow, b: SwapRow): number => a.block - b.block || a.logIndex - b.logIndex;

/** Grupuje swapy po txHash, w każdej grupie posortowane wg (block, logIndex). Kolejność grup: pierwsze wystąpienie. */
export function groupByTx(swaps: SwapRow[]): Map<string, SwapRow[]> {
  const grouped = new Map<string, SwapRow[]>();
  for (const s of [...swaps].sort(byLog)) {
    const existing = grouped.get(s.txHash);
    if (existing) existing.push(s);
    else grouped.set(s.txHash, [s]);
  }
  return grouped;
}

const poolOf = (ctx: DetectContext, poolId: number): PoolMeta | undefined =>
  ctx.pools.find((p) => p.id === poolId);

/** Kierunek pierwszego (wg log_index) swapu danej puli w tx — zgodnie z regułą dla tx z wieloma swapami w jednej puli. */
function poolDirection(swaps: SwapRow[], pool: PoolMeta, pair: PairMeta): PairDirection | null {
  const first = swaps.find((s) => s.poolId === pool.id);
  return first ? toPairDirection(first, pool, pair) : null;
}

/**
 * Kandydaci na atomowy arbitraż: tx dotykająca obu puli z przeciwnymi kierunkami
 * (jedna BUY_BASE, druga SELL_BASE). Wynik posortowany wg (block, logIndex) pierwszego swapu.
 */
export function findAtomicCandidates(swaps: SwapRow[], ctx: DetectContext): AtomicCandidate[] {
  const [poolA, poolB] = ctx.pools;
  const out: AtomicCandidate[] = [];
  for (const [txHash, group] of groupByTx(swaps)) {
    const dirA = poolDirection(group, poolA, ctx.pair);
    const dirB = poolDirection(group, poolB, ctx.pair);
    if (!dirA || !dirB) continue;
    if (dirA === "AMBIGUOUS" || dirB === "AMBIGUOUS" || dirA === dirB) continue;

    const buyPoolId = dirA === "BUY_BASE" ? poolA.id : poolB.id;
    const sellPoolId = dirA === "BUY_BASE" ? poolB.id : poolA.id;
    const recipients = new Set(group.map((s) => s.to.toLowerCase()));
    // group jest niepuste z konstrukcji (groupByTx nigdy nie tworzy pustej grupy).
    const first = group[0]!;

    out.push({
      txHash,
      block: first.block,
      swaps: group,
      buyPoolId,
      sellPoolId,
      beneficiary: recipients.size === 1 ? first.to : null,
    });
  }
  return out.sort((a, b) => byLog(a.swaps[0]!, b.swaps[0]!));
}

/**
 * Pierwszy (wg log_index) swap zmniejszający spread w danym bloku: SELL_BASE w droższej
 * puli (`expensivePoolId`) lub BUY_BASE w tańszej. `null` gdy brak takiego swapu.
 */
export function findPartialConsumer(
  swaps: SwapRow[],
  ctx: DetectContext,
  expensivePoolId: number,
): SwapRow | null {
  for (const s of [...swaps].sort(byLog)) {
    const pool = poolOf(ctx, s.poolId);
    if (!pool) continue;
    const dir = toPairDirection(s, pool, ctx.pair);
    const narrowsSpread =
      (s.poolId === expensivePoolId && dir === "SELL_BASE") ||
      (s.poolId !== expensivePoolId && dir === "BUY_BASE");
    if (narrowsSpread) return s;
  }
  return null;
}
