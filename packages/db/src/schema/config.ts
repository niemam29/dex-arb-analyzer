import { sql } from "drizzle-orm";
import { bigint, char, check, integer, pgTable, serial, smallint, text, timestamp, unique } from "drizzle-orm/pg-core";

/** DEX-y V2 (x·y=k); fee_bps = 30 dla Uniswap V2 i Sushiswap. */
export const dexes = pgTable("dexes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  factory: char("factory", { length: 42 }).notNull(),
  feeBps: smallint("fee_bps").notNull(),
});

export const tokens = pgTable("tokens", {
  address: char("address", { length: 42 }).primaryKey(),
  symbol: text("symbol").notNull(),
  decimals: smallint("decimals").notNull(),
});

/** Para logiczna, np. WETH/USDC: base = WETH, quote = USDC (cena = quote za 1 base). */
export const pairs = pgTable(
  "pairs",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull().unique(),
    tokenBase: char("token_base", { length: 42 }).notNull().references(() => tokens.address),
    tokenQuote: char("token_quote", { length: 42 }).notNull().references(() => tokens.address),
  },
  (t) => [check("pairs_tokens_differ_check", sql`${t.tokenBase} <> ${t.tokenQuote}`)],
);

/** Konkretna pula (kontrakt) danej pary na danym DEX-ie; token0/token1 wg kontraktu. */
export const pools = pgTable(
  "pools",
  {
    id: serial("id").primaryKey(),
    dexId: integer("dex_id").notNull().references(() => dexes.id),
    pairId: integer("pair_id").notNull().references(() => pairs.id),
    address: char("address", { length: 42 }).notNull().unique(),
    token0: char("token0", { length: 42 }).notNull().references(() => tokens.address),
    token1: char("token1", { length: 42 }).notNull().references(() => tokens.address),
  },
  (t) => [
    unique("pools_dex_pair_unique").on(t.dexId, t.pairId),
    check("pools_tokens_differ_check", sql`${t.token0} <> ${t.token1}`),
  ],
);

/** Okno czasowe analizy; from_block/to_block wypełnia ingest (binary search po timestampach). */
export const windows = pgTable(
  "windows",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    fromTs: timestamp("from_ts", { withTimezone: true }).notNull(),
    toTs: timestamp("to_ts", { withTimezone: true }).notNull(),
    fromBlock: bigint("from_block", { mode: "number" }),
    toBlock: bigint("to_block", { mode: "number" }),
  },
  (t) => [
    check("windows_ts_order_check", sql`${t.fromTs} < ${t.toTs}`),
    check("windows_blocks_order_check", sql`${t.fromBlock} IS NULL OR ${t.toBlock} IS NULL OR ${t.fromBlock} <= ${t.toBlock}`),
  ],
);
