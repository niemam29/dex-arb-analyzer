// Warstwa DB: zakresy do ingestu (ingest_ranges) — wznawianie i idempotencja.
import { schema, type Db } from "@dex-arb/db";
import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import type { BlockRange } from "../utils/chunks.js";

/** Limit parametrów Postgresa (65 535) — wstawki partiami po 1000 wierszy. */
const BATCH = 1000;

/** Wstawia zakresy do przetworzenia. ON CONFLICT DO NOTHING po PK (pool_id, from_block, to_block) —
 * bezpieczne przy ponownym planowaniu tych samych chunków (np. po restarcie workera). */
export async function ensureRanges(db: Db, poolId: number, ranges: BlockRange[]): Promise<void> {
  if (ranges.length === 0) return;
  for (let i = 0; i < ranges.length; i += BATCH) {
    await db
      .insert(schema.ingestRanges)
      .values(ranges.slice(i, i + BATCH).map((r) => ({ poolId, fromBlock: r.fromBlock, toBlock: r.toBlock })))
      .onConflictDoNothing();
  }
}

/** Zakresy nieukończone (status != 'done', tj. 'pending' lub 'failed'), posortowane rosnąco. */
export async function listPendingRanges(db: Db, poolId: number, fromBlock: number, toBlock: number): Promise<BlockRange[]> {
  return db
    .select({ fromBlock: schema.ingestRanges.fromBlock, toBlock: schema.ingestRanges.toBlock })
    .from(schema.ingestRanges)
    .where(
      and(
        eq(schema.ingestRanges.poolId, poolId),
        ne(schema.ingestRanges.status, "done"),
        gte(schema.ingestRanges.fromBlock, fromBlock),
        lte(schema.ingestRanges.toBlock, toBlock),
      ),
    )
    .orderBy(asc(schema.ingestRanges.fromBlock));
}

export async function markRange(db: Db, poolId: number, r: BlockRange, status: "done" | "failed", error?: string): Promise<void> {
  await db
    .update(schema.ingestRanges)
    .set({ status, error: error ?? null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.ingestRanges.poolId, poolId),
        eq(schema.ingestRanges.fromBlock, r.fromBlock),
        eq(schema.ingestRanges.toBlock, r.toBlock),
      ),
    );
}
