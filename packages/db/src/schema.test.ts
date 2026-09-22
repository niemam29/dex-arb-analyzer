import { describe, expect, it } from "vitest";
import { createTestDb } from "./client.js";

// Testy schematu na realnym Postgresie — WYŁĄCZNIE DATABASE_URL_TEST (nigdy DATABASE_URL);
// createTestDb() odmawia połączenia, gdy nazwa bazy nie kończy się na „_test".
const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)("schemat bazy po migracji", () => {
  it("zawiera 15 tabel z sekcji 3 specu", async () => {
    const { sql } = createTestDb(url!);
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name <> '__drizzle_migrations'
      order by table_name`;
    await sql.end();
    expect(rows.map((r) => r.table_name)).toEqual([
      "block_states",
      "blocks",
      "dexes",
      "ingest_ranges",
      "jobs",
      "model_scores",
      "opportunities",
      "opportunity_verifications",
      "pairs",
      "pools",
      "scoring_models",
      "swap_events",
      "sync_events",
      "tokens",
      "windows",
    ]);
  });

  it("sync_events ma klucz główny (pool_id, block, log_index)", async () => {
    const { sql } = createTestDb(url!);
    const rows = await sql<{ column_name: string }[]>`
      select kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
      where tc.table_name = 'sync_events' and tc.constraint_type = 'PRIMARY KEY'
      order by kcu.ordinal_position`;
    await sql.end();
    expect(rows.map((r) => r.column_name)).toEqual(["pool_id", "block", "log_index"]);
  });

  it("odstępstwa od domyślnego NOT NULL: nullability swap_events, jobs.attempts, block_states.direction/gross_profit_usd", async () => {
    const { sql } = createTestDb(url!);
    const rows = await sql<
      { table_name: string; column_name: string; is_nullable: string; column_default: string | null; data_type: string }[]
    >`
      select table_name, column_name, is_nullable, column_default, data_type
      from information_schema.columns
      where (table_name = 'swap_events' and column_name in ('sender', 'to', 'amount0_in', 'amount0_out', 'amount1_in', 'amount1_out'))
         or (table_name = 'jobs' and column_name in ('attempts', 'error'))
         or (table_name = 'block_states' and column_name in ('direction', 'gross_profit_usd'))
      order by table_name, column_name`;
    await sql.end();

    const byColumn = Object.fromEntries(rows.map((r) => [`${r.table_name}.${r.column_name}`, r]));

    // pola swap_events wypełniane backfillem — nullable
    for (const col of ["sender", "to", "amount0_in", "amount0_out", "amount1_in", "amount1_out"]) {
      expect(byColumn[`swap_events.${col}`]?.is_nullable, col).toBe("YES");
    }

    // jobs.attempts — licznik prób workera
    expect(byColumn["jobs.attempts"]).toMatchObject({
      is_nullable: "NO",
      column_default: "0",
      data_type: "integer",
    });

    // block_states.direction / gross_profit_usd
    // (direction jest pgEnum direction_kind, nie text)
    expect(byColumn["block_states.direction"]).toMatchObject({
      is_nullable: "NO",
      column_default: "'none'::direction_kind",
      data_type: "USER-DEFINED",
    });
    expect(byColumn["block_states.gross_profit_usd"]).toMatchObject({
      is_nullable: "NO",
      column_default: "0",
      data_type: "double precision",
    });

    // jobs.error — komunikat błędu ostatniej próby, nullable
    expect(byColumn["jobs.error"]).toMatchObject({
      is_nullable: "YES",
      data_type: "text",
    });
  });

  it("ingest_ranges ma klucz główny (pool_id, from_block, to_block)", async () => {
    const { sql } = createTestDb(url!);
    const rows = await sql<{ column_name: string }[]>`
      select kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
      where tc.table_name = 'ingest_ranges' and tc.constraint_type = 'PRIMARY KEY'
      order by kcu.ordinal_position`;
    await sql.end();
    expect(rows.map((r) => r.column_name)).toEqual(["pool_id", "from_block", "to_block"]);
  });

  it("opportunities ma unikalne ograniczenie (pair_id, block) dla idempotentnego upsertu", async () => {
    const { sql } = createTestDb(url!);
    const rows = await sql<{ column_name: string; constraint_type: string }[]>`
      select kcu.column_name, tc.constraint_type
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
      where tc.table_name = 'opportunities' and tc.constraint_name = 'opportunities_pair_block_unique'
      order by kcu.ordinal_position`;
    await sql.end();
    expect(rows.map((r) => r.constraint_type)).toEqual(["UNIQUE", "UNIQUE"]);
    expect(rows.map((r) => r.column_name)).toEqual(["pair_id", "block"]);
  });

  it("scoring_models ma unikalne ograniczenie (name, version) dla idempotentnego upsertu", async () => {
    const { sql } = createTestDb(url!);
    const rows = await sql<{ column_name: string; constraint_type: string }[]>`
      select kcu.column_name, tc.constraint_type
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
      where tc.table_name = 'scoring_models' and tc.constraint_name = 'scoring_models_name_version_unique'
      order by kcu.ordinal_position`;
    await sql.end();
    expect(rows.map((r) => r.constraint_type)).toEqual(["UNIQUE", "UNIQUE"]);
    expect(rows.map((r) => r.column_name)).toEqual(["name", "version"]);
  });

  it("model_scores.label jest pgEnum feasibility_label", async () => {
    const { sql } = createTestDb(url!);
    const rows = await sql<{ data_type: string; udt_name: string }[]>`
      select data_type, udt_name from information_schema.columns
      where table_name = 'model_scores' and column_name = 'label'`;
    await sql.end();
    expect(rows[0]).toMatchObject({ data_type: "USER-DEFINED", udt_name: "feasibility_label" });
  });
});
