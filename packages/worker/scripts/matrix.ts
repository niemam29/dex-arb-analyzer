// Skrypt CLI: orkiestracja macierzy pary×okna — planuje (i, bez --dry-run,
// zleca) ingest:pool-window -> analyze:pair-window (WETH/USDC pierwsza) -> verify:pair-window
// dla wszystkich par i okien (lub podzbioru --pairs/--windows). Worker wykonuje zadania
// SEKWENCYJNIE wg id (packages/worker/src/runner.ts, claim FOR UPDATE SKIP LOCKED w kolejności
// wstawienia) — kolejność wstawiania tu odpowiada więc kolejności wykonania.
//
// Uruchomienie: npm run matrix -w @dex-arb/worker -- [--pairs WETH/USDC,...]
//   [--windows "2021-11 ATH",...] [--dry-run] [--force] [--no-skip-done]
// .env ładowany przez `tsx --env-file=../../.env` (patrz package.json).
//
// Pokrycie (ingest 100% / block_states obecne) czytane przez `loadCoverage` z `@dex-arb/db`
// (ta sama SQL co GET /coverage i `npm run coverage -w @dex-arb/api` — nie duplikuje SQL).
// Weryfikacje (verify done) nie są częścią loadCoverage (poza jego zakresem — dotyczy
// wyłącznie pokrycia ingestu) — doliczone tu jednym, osobnym zapytaniem.
import { createDb, loadCoverage, schema } from "@dex-arb/db";
import { eq, inArray, sql } from "drizzle-orm";
import { parseJobParams } from "@dex-arb/shared";
import { parseMatrixArgs } from "../src/matrix/args.js";
import {
  jobKeyFromRow,
  planMatrix,
  type JobSpec,
  type MatrixState,
  type PairInfo,
  type PlanOptions,
  type PoolInfo,
  type VerifyCounts,
  type WindowInfo,
} from "../src/matrix/plan.js";

/** SQLSTATE 23505 = unique_violation — patrz `packages/api/src/routes/jobs.ts` (`isUniqueViolation`,
 * ten sam powód: drizzle-orm/postgres-js opakowuje PostgresError w `.cause`). */
function isUniqueViolation(err: unknown): boolean {
  const code = (o: unknown): unknown => (typeof o === "object" && o !== null && "code" in o ? (o as { code?: unknown }).code : undefined);
  return code(err) === "23505" || code((err as { cause?: unknown } | null)?.cause) === "23505";
}

async function loadState(db: ReturnType<typeof createDb>["db"]): Promise<MatrixState> {
  const pairs: PairInfo[] = await db.select({ id: schema.pairs.id, symbol: schema.pairs.symbol }).from(schema.pairs);
  const pools: PoolInfo[] = (
    await db
      .select({ id: schema.pools.id, pairId: schema.pools.pairId, dexName: schema.dexes.name })
      .from(schema.pools)
      .innerJoin(schema.dexes, eq(schema.dexes.id, schema.pools.dexId))
  ).map((p) => ({ id: p.id, pairId: p.pairId, dexName: p.dexName }));
  const windows: WindowInfo[] = (await db.select().from(schema.windows)).map((w) => ({
    id: w.id,
    name: w.name,
    fromBlock: w.fromBlock,
    toBlock: w.toBlock,
  }));

  const coverage = await loadCoverage(db);
  const ingestDone = new Set<string>();
  const analyzeDone = new Set<string>();
  for (const cell of coverage) {
    if (cell.block_states > 0) analyzeDone.add(`${cell.pair_id}:${cell.window_id}`);
    for (const pool of cell.pools) {
      if (pool.coverage_pct === 100) ingestDone.add(`${pool.pool_id}:${cell.window_id}`);
    }
  }

  // verify jest "done" tylko gdy verified === opportunities (mirror reguły ingestu:
  // NIE "jakakolwiek weryfikacja istnieje", tylko pełne pokrycie). LEFT JOIN liczy oba
  // liczniki jednym zapytaniem: count(*) = wszystkie okazje pary/okna, count(ov.opportunity_id) =
  // te, które mają już wiersz w opportunity_verifications (LEFT JOIN nie liczy NULL-i).
  const verifyRows = (await db.execute(sql`
    SELECT o.pair_id, o.window_id, count(*)::int AS opportunities, count(ov.opportunity_id)::int AS verified
    FROM opportunities o
    LEFT JOIN opportunity_verifications ov ON ov.opportunity_id = o.id
    GROUP BY 1, 2
  `)) as unknown as { pair_id: number; window_id: number; opportunities: number; verified: number }[];
  const verifyCounts = new Map<string, VerifyCounts>(
    verifyRows.map((r) => [`${r.pair_id}:${r.window_id}`, { opportunities: r.opportunities, verified: r.verified }]),
  );

  const activeRows = await db
    .select({ type: schema.jobs.type, params: schema.jobs.params })
    .from(schema.jobs)
    .where(inArray(schema.jobs.status, ["queued", "running"]));
  // Klucz przez jobKeyFromRow -> jobKey() (jedno źródło prawdy, pomija `force`) — inline'owa
  // wersja z `force` w kluczu nie dedupowała aktywnego verify {force: true} (regresja po 4db7a4d).
  const activeJobs = new Set(activeRows.map(jobKeyFromRow));

  return { pairs, pools, windows, ingestDone, analyzeDone, verifyCounts, activeJobs };
}

function printPlan(plan: JobSpec[]): void {
  const totalMin = plan.reduce((s, j) => s + j.estMinutes, 0);
  const byType = plan.reduce<Record<string, number>>((m, j) => {
    m[j.type] = (m[j.type] ?? 0) + 1;
    return m;
  }, {});
  console.log(`Zaplanowano ${plan.length} zadań, szacowany czas ~${(totalMin / 60).toFixed(1)} h (${Math.round(totalMin)} min)`);
  console.log(byType);
  for (const j of plan) {
    console.log(`  ${j.type.padEnd(20)} ${JSON.stringify(j.params).padEnd(28)} ~${j.estMinutes.toFixed(1)} min`);
  }
}

async function main(): Promise<void> {
  const args = parseMatrixArgs(process.argv.slice(2));
  const { db, sql: client } = createDb();
  try {
    const state = await loadState(db);
    // exactOptionalPropertyTypes: nie wolno przekazać `pairs`/`windows` jawnie jako `undefined` —
    // dokładane warunkowo, tylko gdy faktycznie podane (--pairs/--windows).
    const planOpts: PlanOptions = { force: args.force, skipDone: args.skipDone };
    if (args.pairs) planOpts.pairs = args.pairs;
    if (args.windows) planOpts.windows = args.windows;
    const plan = planMatrix(state, planOpts);
    printPlan(plan);

    if (args.dryRun) {
      console.log("(--dry-run: nic nie zlecono)");
      return;
    }
    let inserted = 0;
    let skipped = 0;
    for (const j of plan) {
      const params = parseJobParams(j.type, j.params);
      try {
        await db.insert(schema.jobs).values({ type: j.type, params }).returning();
        inserted++;
      } catch (err) {
        if (isUniqueViolation(err)) {
          skipped++;
          continue;
        }
        throw err;
      }
    }
    console.log(`Zakolejkowano ${inserted} zadań (pominięto ${skipped} duplikatów). Uruchom worker: npm run start -w @dex-arb/worker`);
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => {
  console.error("BŁĄD:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
