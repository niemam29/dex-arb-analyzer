// Skrypt CLI: raport pokrycia par×okien. Reużywa `loadCoverage`
// (packages/db/src/queries/coverage.ts, ta sama SQL co GET /coverage — nie duplikuje SQL)
// i dokłada liczbę okazji + weryfikacje wg statusu, których
// loadCoverage nie liczy (poza jego zakresem — dotyczy wyłącznie pokrycia ingestu) — jednym, osobnym zapytaniem poniżej.
// Uruchomienie: npm run coverage -w @dex-arb/api -- [--json]
// .env ładowany przez `tsx --env-file=../../.env` (patrz package.json).
import { createDb, loadCoverage, loadOpportunityCounts, schema, type Db } from "@dex-arb/db";
import { sql } from "drizzle-orm";
import type { CoverageCellDto } from "@dex-arb/shared";

export interface VerificationCounts {
  total: number;
  byStatus: Record<string, number>;
}

export interface PoolIngestRow {
  dexName: string;
  doneBlocks: number;
  totalBlocks: number;
  coveragePct: number | null;
}

export interface CoverageReportRow {
  pair: string;
  window: string;
  pools: PoolIngestRow[];
  blockStates: number;
  statesMinBlock: number | null;
  statesMaxBlock: number | null;
  windowHasBlocks: boolean;
  opportunities: number;
  verifications: VerificationCounts;
}

type VerifRow = { pair_id: number; window_id: number; status: string; n: string };

const key = (pairId: number, windowId: number): string => `${pairId}:${windowId}`;

async function loadVerificationCounts(db: Db): Promise<Map<string, VerificationCounts>> {
  const rows = (await db.execute(sql`
    SELECT o.pair_id, o.window_id, ov.status, count(*) AS n
    FROM opportunities o
    JOIN opportunity_verifications ov ON ov.opportunity_id = o.id
    GROUP BY 1, 2, 3
  `)) as unknown as VerifRow[];
  const map = new Map<string, VerificationCounts>();
  for (const r of rows) {
    const k = key(r.pair_id, r.window_id);
    const entry = map.get(k) ?? { total: 0, byStatus: {} };
    entry.byStatus[r.status] = Number(r.n);
    entry.total += Number(r.n);
    map.set(k, entry);
  }
  return map;
}

/** Czysta funkcja (bez I/O) — łączy `loadCoverage` z okazjami/weryfikacjami i nazwami par/okien. */
export function buildReport(
  cells: CoverageCellDto[],
  pairs: { id: number; symbol: string }[],
  windows: { id: number; name: string }[],
  opportunityCounts: Map<string, number>,
  verifications: Map<string, VerificationCounts>,
): CoverageReportRow[] {
  const pairName = new Map(pairs.map((p) => [p.id, p.symbol]));
  const windowName = new Map(windows.map((w) => [w.id, w.name]));
  return cells
    .map((c) => ({
      pair: pairName.get(c.pair_id) ?? `#${c.pair_id}`,
      window: windowName.get(c.window_id) ?? `#${c.window_id}`,
      pools: c.pools.map((p) => ({
        dexName: p.dex_name,
        doneBlocks: p.done_blocks,
        totalBlocks: p.total_blocks,
        coveragePct: p.coverage_pct,
      })),
      blockStates: c.block_states,
      statesMinBlock: c.states_min_block,
      statesMaxBlock: c.states_max_block,
      windowHasBlocks: c.window_has_blocks,
      opportunities: opportunityCounts.get(key(c.pair_id, c.window_id)) ?? 0,
      verifications: verifications.get(key(c.pair_id, c.window_id)) ?? { total: 0, byStatus: {} },
    }))
    .sort((a, b) => a.window.localeCompare(b.window) || a.pair.localeCompare(b.pair));
}

/** Tabela czytelna w terminalu — jeden wiersz na (para, okno); liczba pul (kolumn ingestu) jest
 * zmienna między parami, stąd format "para | okno" + lista `dex=pct%` zamiast sztywnej tabeli
 * markdown (nie da się mieć stałej liczby kolumn ingestu przy różnej liczbie pul na parę). */
export function formatTable(rows: CoverageReportRow[]): string {
  if (rows.length === 0) return "Brak danych pokrycia (brak par lub okien w bazie).\n";
  const lines: string[] = [];
  for (const r of rows) {
    const ingest = r.windowHasBlocks
      ? r.pools.map((p) => `${p.dexName}=${p.coveragePct == null ? "n/a" : `${Math.round(p.coveragePct)}%`}`).join(", ")
      : "okno bez rozstrzygniętych bloków";
    const states =
      r.statesMinBlock != null && r.statesMaxBlock != null
        ? `${r.blockStates} (${r.statesMinBlock}–${r.statesMaxBlock})`
        : `${r.blockStates}`;
    const statuses = Object.entries(r.verifications.byStatus)
      .map(([s, n]) => `${s}=${n}`)
      .join(", ");
    lines.push(
      `${r.pair.padEnd(11)} ${r.window.padEnd(16)} ingest: ${ingest.padEnd(28)} stany bloków: ${states.padEnd(20)} ` +
        `okazje: ${r.opportunities}  zweryfikowane: ${r.verifications.total}/${r.opportunities}` +
        (statuses ? ` (${statuses})` : ""),
    );
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const asJson = process.argv.includes("--json");
  const { db, sql: client } = createDb();
  try {
    const [cells, pairs, windows, opportunityCounts, verifications] = await Promise.all([
      loadCoverage(db),
      db.select({ id: schema.pairs.id, symbol: schema.pairs.symbol }).from(schema.pairs),
      db.select({ id: schema.windows.id, name: schema.windows.name }).from(schema.windows),
      loadOpportunityCounts(db),
      loadVerificationCounts(db),
    ]);
    const rows = buildReport(cells, pairs, windows, opportunityCounts, verifications);
    console.log(asJson ? JSON.stringify(rows, null, 2) : formatTable(rows));
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => {
  console.error("BŁĄD:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
