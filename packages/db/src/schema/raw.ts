import { sql } from "drizzle-orm";
import {
  bigint, char, check, index, integer, numeric, pgEnum, pgTable, primaryKey, text, timestamp,
} from "drizzle-orm/pg-core";
import { pools } from "./config.js";

/** Bloki z eventami; base_fee NULL przed EIP-1559; gas_price_median = mediana gas price wszystkich tx. */
export const blocks = pgTable("blocks", {
  number: bigint("number", { mode: "number" }).primaryKey(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  baseFee: numeric("base_fee", { precision: 40, scale: 0 }),
  gasPriceMedian: numeric("gas_price_median", { precision: 40, scale: 0 }),
  txCount: integer("tx_count"),
});

export const syncEvents = pgTable(
  "sync_events",
  {
    poolId: integer("pool_id").notNull().references(() => pools.id),
    block: bigint("block", { mode: "number" }).notNull(),
    logIndex: integer("log_index").notNull(),
    txHash: char("tx_hash", { length: 66 }).notNull(),
    reserve0: numeric("reserve0", { precision: 40, scale: 0 }).notNull(),
    reserve1: numeric("reserve1", { precision: 40, scale: 0 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.poolId, t.block, t.logIndex] }),
    index("sync_events_block_idx").on(t.block),
  ],
);

/**
 * sender/to/amount*In/Out i gas_price są nullable: import CSV w etapie 1 nie zawiera tych pól,
 * uzupełnia je backfill z eth_getTransactionReceipt/eth_getBlockByNumber.
 */
export const swapEvents = pgTable(
  "swap_events",
  {
    poolId: integer("pool_id").notNull().references(() => pools.id),
    block: bigint("block", { mode: "number" }).notNull(),
    logIndex: integer("log_index").notNull(),
    txHash: char("tx_hash", { length: 66 }).notNull(),
    sender: char("sender", { length: 42 }),
    to: char("to", { length: 42 }),
    amount0In: numeric("amount0_in", { precision: 40, scale: 0 }),
    amount0Out: numeric("amount0_out", { precision: 40, scale: 0 }),
    amount1In: numeric("amount1_in", { precision: 40, scale: 0 }),
    amount1Out: numeric("amount1_out", { precision: 40, scale: 0 }),
    /** effective gas price tx (wei); uzupełniany backfillem z eth_getBlockByNumber */
    gasPrice: numeric("gas_price", { precision: 40, scale: 0 }),
  },
  (t) => [
    primaryKey({ columns: [t.poolId, t.block, t.logIndex] }),
    index("swap_events_block_idx").on(t.block),
    index("swap_events_tx_hash_idx").on(t.txHash),
  ],
);

export const ingestStatusEnum = pgEnum("ingest_status", ["pending", "done", "failed"]);

/** Chunki ingestu — wznawianie i idempotencja. */
export const ingestRanges = pgTable(
  "ingest_ranges",
  {
    poolId: integer("pool_id").notNull().references(() => pools.id),
    fromBlock: bigint("from_block", { mode: "number" }).notNull(),
    toBlock: bigint("to_block", { mode: "number" }).notNull(),
    status: ingestStatusEnum("status").notNull().default("pending"),
    error: text("error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.poolId, t.fromBlock, t.toBlock] }),
    check("ingest_ranges_from_le_to_check", sql`${t.fromBlock} <= ${t.toBlock}`),
  ],
);
