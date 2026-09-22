// Testy integracyjne warstwy DB pakietu ingest (ranges/events/blocks) na realnym Postgresie.
// Uruchomienie: DATABASE_URL_TEST=postgres://dexarb:dexarb@localhost:5433/dexarb_test npx vitest run packages/ingest
// Bez DATABASE_URL_TEST cały opis jest pomijany (describe.skipIf) — bezpieczne na CI bez usługi bazy.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { HAS_DB, resetDb } from "./helpers/db.js";
import { ensureRanges, listPendingRanges, markRange } from "../src/db/ranges.js";
import { insertEvents, blocksNeedingBackfill } from "../src/db/events.js";
import { upsertBlocks, updateSwapGasPrices } from "../src/db/blocks.js";
import type { DecodedEvent } from "../src/decode.js";

const TX = "0x7a6f0482e2de7d67f3d93fae464bf10214dd945f2326d1cb1c318347c840ec8a";
const sync = (block: number, logIndex: number): DecodedEvent => ({ kind: "sync", block, logIndex, txHash: TX, reserve0: 1n, reserve1: 2n });
const swap = (block: number, logIndex: number): DecodedEvent => ({
  kind: "swap",
  block,
  logIndex,
  txHash: TX,
  sender: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  amount0In: 10n,
  amount1In: 0n,
  amount0Out: 0n,
  amount1Out: 5n,
});

describe.skipIf(!HAS_DB)("warstwa DB ingest", () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let poolId: number;

  beforeAll(() => {
    const conn = createTestDb();
    db = conn.db;
    closeDb = () => conn.sql.end();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    ({ poolId } = await resetDb(db));
  });

  it("ensureRanges jest idempotentne; listPendingRanges pomija done; markRange zapisuje błąd", async () => {
    const ranges = [
      { fromBlock: 100, toBlock: 199 },
      { fromBlock: 200, toBlock: 299 },
    ];
    await ensureRanges(db, poolId, ranges);
    await ensureRanges(db, poolId, ranges); // druga wstawka nie tworzy duplikatów (ON CONFLICT DO NOTHING)
    expect(await listPendingRanges(db, poolId, 100, 299)).toEqual(ranges);

    await markRange(db, poolId, ranges[0]!, "done");
    await markRange(db, poolId, ranges[1]!, "failed", "boom");
    expect(await listPendingRanges(db, poolId, 100, 299)).toEqual([ranges[1]]);

    const [row] = await db
      .select()
      .from(schema.ingestRanges)
      .where(and(eq(schema.ingestRanges.poolId, poolId), eq(schema.ingestRanges.fromBlock, 200)));
    expect(row!.status).toBe("failed");
    expect(row!.error).toBe("boom");
  });

  it("insertEvents ignoruje duplikaty sync i uzupełnia swap z pustymi kwotami", async () => {
    const r1 = await insertEvents(db, poolId, [sync(100, 1), swap(100, 2)]);
    expect(r1).toEqual({ sync: 1, swap: 1 });

    await insertEvents(db, poolId, [sync(100, 1), swap(100, 2)]); // duplikaty — brak nowych wierszy
    expect((await db.select().from(schema.syncEvents)).length).toBe(1);

    // symulacja wiersza wstawionego wcześniej importem CSV (bez kwot/sendera/to)
    await db.insert(schema.swapEvents).values({ poolId, block: 101, logIndex: 7, txHash: TX });
    await insertEvents(db, poolId, [swap(101, 7)]);
    const [row] = await db.select().from(schema.swapEvents).where(eq(schema.swapEvents.block, 101));
    expect(row!.amount0In).toBe("10");
    expect(row!.sender).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  });

  it("insertEvents NIE nadpisuje swapa, który ma już wypełnione kwoty (setWhere amount0_in IS NULL)", async () => {
    // wiersz już uzupełniony (np. wcześniejszym insertEvents/backfillem) — inne kwoty niż `swap()` niżej
    await insertEvents(db, poolId, [swap(102, 1)]);
    const [before] = await db.select().from(schema.swapEvents).where(eq(schema.swapEvents.block, 102));
    expect(before!.amount0In).toBe("10");
    expect(before!.sender).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");

    // druga próba wstawienia tego samego (block, logIndex) z INNYMI wartościami — musi zostać zignorowana,
    // bo w bazie amount0_in już NIE jest NULL (setWhere blokuje UPDATE z ON CONFLICT)
    const other: DecodedEvent = {
      kind: "swap",
      block: 102,
      logIndex: 1,
      txHash: TX,
      sender: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      amount0In: 999n,
      amount1In: 0n,
      amount0Out: 0n,
      amount1Out: 777n,
    };
    await insertEvents(db, poolId, [other]);

    const [after] = await db.select().from(schema.swapEvents).where(eq(schema.swapEvents.block, 102));
    expect(after!.amount0In).toBe("10");
    expect(after!.amount1Out).toBe("5");
    expect(after!.sender).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    expect(after!.to).toBe("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
  });

  it("blocksNeedingBackfill: brak bloku lub swap bez gas_price", async () => {
    await insertEvents(db, poolId, [sync(100, 1), swap(100, 2), sync(105, 1), swap(110, 3)]);
    expect(await blocksNeedingBackfill(db, poolId, 100, 200)).toEqual([100, 105, 110]);

    const rows = [
      { number: 100, timestamp: 1, baseFee: null, gasPriceMedian: 7n, txCount: 3, txGasPrice: new Map([[TX, 9n]]) },
      { number: 105, timestamp: 2, baseFee: null, gasPriceMedian: null, txCount: 0, txGasPrice: new Map<string, bigint>() },
    ];
    await upsertBlocks(db, rows);
    expect(await updateSwapGasPrices(db, rows)).toBe(1);
    expect(await blocksNeedingBackfill(db, poolId, 100, 200)).toEqual([110]);

    const [b] = await db.select().from(schema.blocks).where(eq(schema.blocks.number, 100));
    expect(b!.gasPriceMedian).toBe("7");
    const [s] = await db.select().from(schema.swapEvents).where(eq(schema.swapEvents.block, 100));
    expect(s!.gasPrice).toBe("9");
  });
});
