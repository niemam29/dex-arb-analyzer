// Zapytania dla GET /coverage: macierz pokrycia para×okno — pokrycie ingestu
// (`ingest_ranges` per pula, przycięte do okna) + pokrycie analizy (`block_states`,
// `model_scores` per para/okno).
import { sql } from "drizzle-orm";
import type { Db } from "../client.js";

export interface PoolCoverage {
  pool_id: number;
  dex_name: string;
  done_blocks: number;
  failed_blocks: number;
  pending_blocks: number;
  total_blocks: number;
  coverage_pct: number | null;
}

export interface CoverageCell {
  pair_id: number;
  window_id: number;
  window_has_blocks: boolean;
  pools: PoolCoverage[];
  block_states: number;
  states_min_block: number | null;
  states_max_block: number | null;
  scored_models: number;
}

type CellRow = {
  pair_id: number;
  window_id: number;
  pool_id: number;
  dex_name: string;
  // sum()/count() w Postgresie zwracają bigint → driver oddaje string, stąd Number(...) niżej.
  total_blocks: string;
  window_has_blocks: boolean;
};
type StatusRow = { pool_id: number; window_id: number; status: "done" | "failed" | "pending"; blocks: string };
type StateRow = { pair_id: number; window_id: number; n: string; min_block: string | null; max_block: string | null };
type ModelRow = { pair_id: number; window_id: number; n: string };

export async function loadCoverage(db: Db): Promise<CoverageCell[]> {
  // Szkielet macierzy: każda pula danej pary w każdym oknie (nawet bez ani jednego zakresu
  // ingestu) — total_blocks/window_has_blocks nie zależą od ingest_ranges.
  const cellRows = (await db.execute(sql`
    SELECT pl.pair_id, w.id AS window_id, pl.id AS pool_id, d.name AS dex_name,
      coalesce(w.to_block - w.from_block + 1, 0) AS total_blocks,
      (w.from_block IS NOT NULL AND w.to_block IS NOT NULL) AS window_has_blocks
    FROM pools pl
    JOIN dexes d ON d.id = pl.dex_id
    CROSS JOIN windows w
    ORDER BY pl.pair_id, w.id, pl.dex_id
  `)) as unknown as CellRow[];

  // Bloki pokryte przez ingest_ranges per (pula, okno, status), przycięte do okna. Liczone jako
  // UNIA rozłącznych przedziałów (range_agg → int8multirange, Postgres 16), NIE jako prosta
  // suma długości przyciętych zakresów: nakładające się zakresy tego samego statusu (np. po
  // ponownym zaingestowaniu tego samego okna z inną wartością LOGS_CHUNK_BLOCKS) liczyłyby
  // wspólne bloki więcej niż raz i coverage_pct mogłoby przekroczyć 100%. Statusy liczone są
  // NIEZALEŻNIE od siebie — nakładanie się np. done z pending nie
  // jest odejmowane wzajemnie, tylko każdy status ma własną unię (blok w obu unia raz w done,
  // raz w pending — to oczekiwane, "done liczy się raz" dotyczy tylko unii w obrębie statusu).
  const statusRows = (await db.execute(sql`
    WITH clipped AS (
      SELECT ir.pool_id, w.id AS window_id, ir.status,
        int8range(greatest(ir.from_block, w.from_block), least(ir.to_block, w.to_block) + 1) AS r
      FROM ingest_ranges ir
      JOIN windows w ON w.from_block IS NOT NULL AND w.to_block IS NOT NULL
        AND ir.to_block >= w.from_block AND ir.from_block <= w.to_block
    ),
    unioned AS (
      SELECT pool_id, window_id, status, range_agg(r) AS mr
      FROM clipped
      GROUP BY pool_id, window_id, status
    )
    SELECT pool_id, window_id, status, sum(upper(x) - lower(x)) AS blocks
    FROM unioned, unnest(mr) AS x
    GROUP BY pool_id, window_id, status
  `)) as unknown as StatusRow[];

  const stateRows = (await db.execute(sql`
    SELECT pair_id, window_id, count(*) AS n, min(block) AS min_block, max(block) AS max_block
    FROM block_states
    GROUP BY pair_id, window_id
  `)) as unknown as StateRow[];

  // model_scores nie ma window_id — dołączenie po (pair_id, block) block_states przypisuje
  // wynik modelu do okna, do którego blok należy (PK block_states to (pair_id, block), więc
  // dany blok danej pary może należeć tylko do jednego okna naraz).
  const modelRows = (await db.execute(sql`
    SELECT bs.pair_id, bs.window_id, count(DISTINCT ms.model_id) AS n
    FROM model_scores ms
    JOIN block_states bs ON bs.pair_id = ms.pair_id AND bs.block = ms.block
    GROUP BY bs.pair_id, bs.window_id
  `)) as unknown as ModelRow[];

  const key = (p: number, w: number): string => `${p}:${w}`;
  const statusKey = (pool: number, win: number, status: string): string => `${pool}:${win}:${status}`;
  const status = new Map(statusRows.map((r) => [statusKey(r.pool_id, r.window_id, r.status), Number(r.blocks)]));
  const states = new Map(stateRows.map((r) => [key(r.pair_id, r.window_id), r]));
  const models = new Map(modelRows.map((r) => [key(r.pair_id, r.window_id), Number(r.n)]));

  const cells = new Map<string, CoverageCell>();
  for (const r of cellRows) {
    const k = key(r.pair_id, r.window_id);
    if (!cells.has(k)) {
      const st = states.get(k);
      cells.set(k, {
        pair_id: r.pair_id,
        window_id: r.window_id,
        window_has_blocks: r.window_has_blocks,
        pools: [],
        block_states: st ? Number(st.n) : 0,
        states_min_block: st?.min_block != null ? Number(st.min_block) : null,
        states_max_block: st?.max_block != null ? Number(st.max_block) : null,
        scored_models: models.get(k) ?? 0,
      });
    }
    const total = Number(r.total_blocks);
    const done = status.get(statusKey(r.pool_id, r.window_id, "done")) ?? 0;
    const failed = status.get(statusKey(r.pool_id, r.window_id, "failed")) ?? 0;
    const pending = status.get(statusKey(r.pool_id, r.window_id, "pending")) ?? 0;
    const pool: PoolCoverage = {
      pool_id: r.pool_id,
      dex_name: r.dex_name,
      done_blocks: done,
      failed_blocks: failed,
      pending_blocks: pending,
      total_blocks: total,
      // Okno bez wyznaczonych bloków (from_block/to_block NULL) → pokrycie niepoliczalne (null),
      // odróżnione od realnego 0% (kiedy okno istnieje, ale nic jeszcze nie zaingestowano).
      // `done` jest już policzone poprawnie (unia przedziałów) — nie ma tu potrzeby (i nie
      // wolno) doklejać `least(..., 100)` jako maskowania błędu liczenia.
      coverage_pct: r.window_has_blocks ? (total > 0 ? (100 * done) / total : 0) : null,
    };
    cells.get(k)!.pools.push(pool);
  }
  return [...cells.values()];
}

/** Bloki pokryte ingestem `done` per pula w JEDNYM oknie — unia rozłącznych przedziałów (range_agg), używane przez bramkę kompletności analizy (`ensureIngestComplete` w @dex-arb/analysis). */
export async function loadPoolDoneBlocks(db: Db, poolIds: number[], window: { fromBlock: number; toBlock: number }): Promise<Map<number, number>> {
  if (poolIds.length === 0) return new Map();
  const idList = sql.join(poolIds.map((id) => sql`${id}`), sql`, `);
  const rows = (await db.execute(sql`
    WITH clipped AS (
      SELECT ir.pool_id,
        int8range(greatest(ir.from_block, ${window.fromBlock}::bigint), least(ir.to_block, ${window.toBlock}::bigint) + 1) AS r
      FROM ingest_ranges ir
      WHERE ir.pool_id IN (${idList}) AND ir.status = 'done'
        AND ir.to_block >= ${window.fromBlock} AND ir.from_block <= ${window.toBlock}
    ),
    unioned AS (SELECT pool_id, range_agg(r) AS mr FROM clipped GROUP BY pool_id)
    SELECT pool_id, sum(upper(x) - lower(x)) AS blocks FROM unioned, unnest(mr) AS x GROUP BY pool_id
  `)) as unknown as { pool_id: number; blocks: string }[];
  return new Map(rows.map((r) => [r.pool_id, Number(r.blocks)]));
}

/** Liczba okazji per (para, okno) — mapa kluczowana `"<pair_id>:<window_id>"`. Współdzielone przez
 * `scripts/coverage.ts` (raport terminalowy) i `scripts/export-results.ts` (`results/coverage.csv`),
 * żeby nie duplikować tego samego zapytania w dwóch skryptach. */
export async function loadOpportunityCounts(db: Db): Promise<Map<string, number>> {
  const rows = (await db.execute(sql`
    SELECT pair_id, window_id, count(*)::int AS n FROM opportunities GROUP BY 1, 2
  `)) as unknown as { pair_id: number; window_id: number; n: number }[];
  return new Map(rows.map((r) => [`${r.pair_id}:${r.window_id}`, r.n]));
}
