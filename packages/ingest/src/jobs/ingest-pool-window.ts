// Handler zadania ingest:pool-window (spec §4a): wyznacza bloki okna, pobiera logi Sync/Swap
// puli w chunkach (wznawialnie, idempotentnie), a następnie uzupełnia (backfill) bloki i
// gas_price swapów. Postęp/logi raportowane przez JobContext; ctx.signal przerywa między
// zakresami/partiami.
import { schema, type Db } from "@dex-arb/db";
import { eq, sql } from "drizzle-orm";
import type { IngestPoolWindowParams, JobHandler } from "@dex-arb/shared";
import type { IngestEnv } from "../env.js";
import type { RpcLike } from "../logs/fetch-logs.js";
import { ensureRanges, listPendingRanges, markRange } from "../db/ranges.js";
import { blocksNeedingBackfill, insertEvents } from "../db/events.js";
import { updateSwapGasPrices, upsertBlocks } from "../db/blocks.js";
import { resolveWindowBlocks } from "../blocks/find-block.js";
import { fetchBlocks } from "../blocks/fetch-blocks.js";
import { fetchPoolLogs } from "../logs/fetch-logs.js";
import { planChunks } from "../utils/chunks.js";

export interface IngestDeps {
  db: Db;
  rpc: RpcLike & { resetToPrimary(): void };
  env: IngestEnv;
}

/** Wielkość partii backfillu bloków (odrębna od chunków logów — bloki pobierane niezależnie, batch/concurrency z env). */
const BACKFILL_PART = 2000;

/** unix timestamp (sekundy) z kolumny timestamptz — findBlockByTime porównuje z block.timestamp (sekundy). */
const toUnixSeconds = (d: Date): number => Math.floor(d.getTime() / 1000);

export function makeIngestPoolWindow({ db, rpc, env }: IngestDeps): JobHandler<IngestPoolWindowParams> {
  return async ({ poolId, windowId }, ctx) => {
    const [pool] = await db.select().from(schema.pools).where(eq(schema.pools.id, poolId));
    if (!pool) throw new Error(`Brak puli id=${poolId}`);
    let [window] = await db.select().from(schema.windows).where(eq(schema.windows.id, windowId));
    if (!window) throw new Error(`Brak okna id=${windowId}`);

    if (window.fromBlock === null || window.toBlock === null) {
      const { fromBlock, toBlock } = await resolveWindowBlocks(rpc, toUnixSeconds(window.fromTs), toUnixSeconds(window.toTs));
      await db.update(schema.windows).set({ fromBlock, toBlock }).where(eq(schema.windows.id, windowId));
      window = { ...window, fromBlock, toBlock };
      await ctx.log(`Okno "${window.name}": bloki ${fromBlock}–${toBlock}`);
    }
    const fromBlock = window.fromBlock!;
    const toBlock = window.toBlock!;

    // 2–3. chunki logów: zaplanuj (idempotentnie) i pobierz tylko te jeszcze nieukończone.
    const chunks = planChunks(fromBlock, toBlock, env.logsChunkBlocks);
    await ensureRanges(db, poolId, chunks);
    const pending = await listPendingRanges(db, poolId, fromBlock, toBlock);
    await ctx.log(`Pula ${pool.address}: ${chunks.length} chunków, do pobrania ${pending.length}`);
    for (let i = 0; i < pending.length; i++) {
      if (ctx.signal.aborted) throw new Error("Przerwano");
      const r = pending[i]!;
      rpc.resetToPrimary();
      try {
        const events = await fetchPoolLogs(rpc, pool.address, r);
        const n = await insertEvents(db, poolId, events);
        await markRange(db, poolId, r, "done");
        await ctx.log(`chunk ${i + 1}/${pending.length} (bloki ${r.fromBlock}-${r.toBlock}): ${n.sync} sync, ${n.swap} swap`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await markRange(db, poolId, r, "failed", message);
        throw e;
      }
      await ctx.progress(0.7 * ((i + 1) / pending.length));
    }

    // 4. backfill bloków (timestamp/baseFee/gasPriceMedian) i gas_price swapów, w partiach.
    const numbers = await blocksNeedingBackfill(db, poolId, fromBlock, toBlock);
    await ctx.log(`Backfill bloków: ${numbers.length}`);
    for (let i = 0; i < numbers.length; i += BACKFILL_PART) {
      if (ctx.signal.aborted) throw new Error("Przerwano");
      rpc.resetToPrimary();
      const part = numbers.slice(i, i + BACKFILL_PART);
      const rows = await fetchBlocks(rpc, part, env.rpcConcurrency);
      await upsertBlocks(db, rows);
      const updated = await updateSwapGasPrices(db, rows);
      await ctx.log(`bloki ${part[0]}-${part.at(-1)}: ${rows.length} pobranych, ${updated} swapów z gas_price`);
      await ctx.progress(0.7 + 0.3 * Math.min(1, (i + part.length) / numbers.length));
    }

    const [stats] = await db.execute<{ sync: number | string; swap: number | string }>(sql`
      SELECT (SELECT count(*) FROM sync_events WHERE pool_id = ${poolId} AND block BETWEEN ${fromBlock} AND ${toBlock}) AS sync,
             (SELECT count(*) FROM swap_events WHERE pool_id = ${poolId} AND block BETWEEN ${fromBlock} AND ${toBlock}) AS swap`);
    await ctx.log(`Gotowe: ${Number(stats!.sync)} sync, ${Number(stats!.swap)} swap w oknie ${fromBlock}-${toBlock}`);
    await ctx.progress(1);
  };
}
