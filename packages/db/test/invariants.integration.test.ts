import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type Db } from "../src/index.js";

const HAS_DB = Boolean(process.env.DATABASE_URL_TEST);

describe.skipIf(!HAS_DB)("CHECK-i inwariantów (migracja 0007)", () => {
  let db: Db;
  let close: () => Promise<unknown>;
  beforeAll(async () => {
    const c = createTestDb();
    db = c.db;
    close = () => c.sql.end();
    await db.execute(sql`TRUNCATE model_scores, opportunity_verifications, opportunities, block_states, sync_events, swap_events, blocks, ingest_ranges, jobs, windows, pools, pairs, tokens, dexes, scoring_models RESTART IDENTITY CASCADE`);
  });
  afterAll(async () => { await close(); });

  // drizzle opakowuje błąd postgres.js w DrizzleQueryError ("Failed query: ...") — nazwa
  // naruszonego CHECK-a siedzi w `cause.constraint_name`, nie w `.message` (por.
  // packages/api/test/opportunities.test.ts).
  const rejects = async (q: ReturnType<typeof sql>, constraint: string) => {
    await expect(db.execute(q)).rejects.toMatchObject({ cause: { constraint_name: constraint } });
  };

  it("windows: from_ts < to_ts; from_block <= to_block", async () => {
    await rejects(sql`INSERT INTO windows (name, from_ts, to_ts) VALUES ('w-bad', '2021-05-15Z', '2021-05-14Z')`, "windows_ts_order_check");
    await rejects(sql`INSERT INTO windows (name, from_ts, to_ts, from_block, to_block) VALUES ('w-bad2', '2021-05-14Z', '2021-05-15Z', 10, 5)`, "windows_blocks_order_check");
    await db.execute(sql`INSERT INTO windows (name, from_ts, to_ts, from_block, to_block) VALUES ('w-ok', '2021-05-14Z', '2021-05-15Z', NULL, 5)`); // NULL dozwolone
  });

  it("pairs/pools: różne tokeny", async () => {
    await db.execute(sql`INSERT INTO tokens (address, symbol, decimals) VALUES ('0x' || repeat('a', 40), 'A', 18), ('0x' || repeat('b', 40), 'B', 6)`);
    await rejects(sql`INSERT INTO pairs (symbol, token_base, token_quote) VALUES ('A/A', '0x' || repeat('a', 40), '0x' || repeat('a', 40))`, "pairs_tokens_differ_check");
  });

  // Odrzucone INSERT-y i tak zużywają wartości sekwencji `serial`, więc identyfikatory pobieramy
  // podzapytaniami po kluczu naturalnym, nigdy jako literały 1/2/3.
  const PAIR = sql`(SELECT id FROM pairs WHERE symbol = 'A/B')`;
  const WINDOW = sql`(SELECT id FROM windows WHERE name = 'w-ok')`;
  const POOL = sql`(SELECT id FROM pools WHERE address = '0x' || repeat('d', 40))`;
  const MODEL = sql`(SELECT id FROM scoring_models WHERE name = 'b' AND version = 1)`;
  const OPP = sql`(SELECT id FROM opportunities WHERE block = 1)`;

  it("jobs.progress w [0,100]; ingest_ranges from <= to", async () => {
    await rejects(sql`INSERT INTO jobs (type, params, progress) VALUES ('train', '{}', 101)`, "jobs_progress_range_check");
    await db.execute(sql`INSERT INTO dexes (name, factory, fee_bps) VALUES ('d', '0x' || repeat('c', 40), 30)`);
    await db.execute(sql`INSERT INTO pairs (symbol, token_base, token_quote) VALUES ('A/B', '0x' || repeat('a', 40), '0x' || repeat('b', 40))`);
    await db.execute(sql`INSERT INTO pools (dex_id, pair_id, address, token0, token1) VALUES ((SELECT id FROM dexes WHERE name = 'd'), ${PAIR}, '0x' || repeat('d', 40), '0x' || repeat('a', 40), '0x' || repeat('b', 40))`);
    await rejects(sql`INSERT INTO ingest_ranges (pool_id, from_block, to_block) VALUES (${POOL}, 10, 9)`, "ingest_ranges_from_le_to_check");
  });

  it("block_states: cechy w dziedzinach; model_scores.score w [0,100]", async () => {
    const bs = (s: number, m: number) => sql`INSERT INTO block_states (pair_id, window_id, block, price_a, price_b, spread_pct, tvl_min_usd, s, g, l, m) VALUES (${PAIR}, ${WINDOW}, 1, 1, 1, 0, 0, ${s}, 0, 0, ${m})`;
    await rejects(bs(3.5, 50), "block_states_feature_ranges_check");
    await rejects(bs(1, 100.1), "block_states_feature_ranges_check");
    await db.execute(bs(1, 100.0000005)); // tolerancja 1e-6 dla M
    await db.execute(sql`INSERT INTO scoring_models (name, kind, version) VALUES ('b', 'baseline', 1)`);
    await rejects(sql`INSERT INTO model_scores (model_id, pair_id, block, score, label) VALUES (${MODEL}, ${PAIR}, 1, 100.5, 'atrakcyjna')`, "model_scores_score_range_check");
  });

  it("opportunity_verifications: consumer_tx_hash ⇔ status skonsumowany; k w [0,3]", async () => {
    await db.execute(sql`INSERT INTO opportunities (pair_id, window_id, block, spread_pct, direction) VALUES (${PAIR}, ${WINDOW}, 1, 1, 'a_to_b')`);
    await rejects(sql`INSERT INTO opportunity_verifications (opportunity_id, status) VALUES (${OPP}, 'consumed_atomic')`, "opportunity_verifications_consumer_iff_consumed_check");
    await rejects(sql`INSERT INTO opportunity_verifications (opportunity_id, status, consumer_tx_hash) VALUES (${OPP}, 'decayed', '0x' || repeat('e', 64))`, "opportunity_verifications_consumer_iff_consumed_check");
    await rejects(sql`INSERT INTO opportunity_verifications (opportunity_id, status, blocks_to_consumption) VALUES (${OPP}, 'decayed', 4)`, "opportunity_verifications_k_range_check");
    await db.execute(sql`INSERT INTO opportunity_verifications (opportunity_id, status, consumer_tx_hash, blocks_to_consumption, route) VALUES (${OPP}, 'consumed_atomic', '0x' || repeat('e', 64), 3, 'two_pool')`);
  });
});
