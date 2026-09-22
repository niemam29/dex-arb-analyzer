// Warstwa DB: wstawianie zdarzeń Sync/Swap i wykrywanie bloków wymagających uzupełnienia gas_price.
import { schema, type Db } from "@dex-arb/db";
import { isNull, sql } from "drizzle-orm";
import type { DecodedEvent } from "../decode.js";

/** Limit parametrów Postgresa (65 535) — wstawki partiami po 1000 wierszy. */
const BATCH = 1000;

type SyncEvent = Extract<DecodedEvent, { kind: "sync" }>;
type SwapEvent = Extract<DecodedEvent, { kind: "swap" }>;

/**
 * Wstawia zdarzenia zdekodowane z logów. Sync: ON CONFLICT DO NOTHING (idempotentne przy ponownym
 * pobraniu tego samego zakresu). Swap: ON CONFLICT DO UPDATE, ale tylko gdy w bazie amount0_in IS NULL —
 * uzupełnia wiersze wstawione wcześniej importem CSV (bez sendera/kwot), nie nadpisuje już uzupełnionych.
 */
export async function insertEvents(db: Db, poolId: number, events: DecodedEvent[]): Promise<{ sync: number; swap: number }> {
  const syncs = events.filter((e): e is SyncEvent => e.kind === "sync");
  const swaps = events.filter((e): e is SwapEvent => e.kind === "swap");

  for (let i = 0; i < syncs.length; i += BATCH) {
    await db
      .insert(schema.syncEvents)
      .values(
        syncs.slice(i, i + BATCH).map((e) => ({
          poolId,
          block: e.block,
          logIndex: e.logIndex,
          txHash: e.txHash,
          reserve0: e.reserve0.toString(),
          reserve1: e.reserve1.toString(),
        })),
      )
      .onConflictDoNothing();
  }

  for (let i = 0; i < swaps.length; i += BATCH) {
    await db
      .insert(schema.swapEvents)
      .values(
        swaps.slice(i, i + BATCH).map((e) => ({
          poolId,
          block: e.block,
          logIndex: e.logIndex,
          txHash: e.txHash,
          sender: e.sender,
          to: e.to,
          amount0In: e.amount0In.toString(),
          amount1In: e.amount1In.toString(),
          amount0Out: e.amount0Out.toString(),
          amount1Out: e.amount1Out.toString(),
        })),
      )
      .onConflictDoUpdate({
        target: [schema.swapEvents.poolId, schema.swapEvents.block, schema.swapEvents.logIndex],
        set: {
          sender: sql`excluded.sender`,
          to: sql`excluded."to"`,
          amount0In: sql`excluded.amount0_in`,
          amount1In: sql`excluded.amount1_in`,
          amount0Out: sql`excluded.amount0_out`,
          amount1Out: sql`excluded.amount1_out`,
        },
        // unqualified amount0_in odnosi się do wiersza już istniejącego w tabeli (nie do excluded)
        setWhere: isNull(schema.swapEvents.amount0In),
      });
  }

  return { sync: syncs.length, swap: swaps.length };
}

/** Bloki puli w zakresie bez wiersza w blocks lub ze swapem bez uzupełnionego gas_price. */
export async function blocksNeedingBackfill(db: Db, poolId: number, fromBlock: number, toBlock: number): Promise<number[]> {
  const rows = await db.execute<{ block: number | string }>(sql`
    SELECT DISTINCT e.block FROM (
      SELECT block FROM sync_events WHERE pool_id = ${poolId} AND block BETWEEN ${fromBlock} AND ${toBlock}
      UNION
      SELECT block FROM swap_events WHERE pool_id = ${poolId} AND block BETWEEN ${fromBlock} AND ${toBlock}
    ) e
    WHERE NOT EXISTS (SELECT 1 FROM blocks b WHERE b.number = e.block)
       OR EXISTS (SELECT 1 FROM swap_events s WHERE s.pool_id = ${poolId} AND s.block = e.block AND s.gas_price IS NULL)
    ORDER BY e.block`);
  return rows.map((r) => Number(r.block));
}
