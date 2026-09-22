// Eksport wyników do results/ (CSV/MD/LaTeX) — TE SAME zapytania i funkcje co GET /models/:id/evaluation
// (`evaluateModelOnWindow`) i GET /coverage (`loadCoverage`), więc liczby w pracy = liczby w API.
// Uruchomienie: npm run export-results [-- --latex] [-- --out results]
//   [-- --sensitivity-only] [-- --models 1,2,47,49,48]
// `--sensitivity-only` zapisuje WYŁĄCZNIE analizę wrażliwości (`evaluation-sensitivity.{csv,md[,tex]}`)
// i nie dotyka pozostałych plików results/ (praca cytuje ich liczby i SHA z provenance.json);
// bez tej flagi pełny eksport zapisuje wszystko, łącznie z analizą wrażliwości.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { sql } from "drizzle-orm";
import { createDb, gitSha, loadCoverage, loadOpportunityCounts, packageVersion, rpcHostFrom, tableCounts, type Db } from "@dex-arb/db";
import { CONSTANT_TABLE, SCORE_THRESHOLD } from "@dex-arb/core";
import { AnfisMetricsReadSchema } from "@dex-arb/shared";
import { POPULATION_VARIANTS, evaluateModelOnWindow, type ScoringModelRow } from "../src/queries/evaluation.sql.js";
import { SENSITIVITY_COLUMNS, VERIFICATION_STATS_COLUMNS, aggregateSeeds, constantsMarkdown, evaluationLatex, evaluationMarkdown, mainTableRows, sensitivityLatex, sensitivityMarkdown, toCsv, type EvaluationRow, type SensitivityRow } from "./export-results-format.js";

interface WindowRow { id: number; name: string; from_block: number | null; to_block: number | null }

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

/** Modele analizy wrażliwości (domyślne `--models`): baseline (1), mamdani (2), baseline_v2 (47),
 * anfis-w2 (49), anfis-w2w4 (48) — wiersze tabeli głównej pracy; kolejność = kolejność w tabeli. */
const SENSITIVITY_MODEL_IDS = [1, 2, 47, 49, 48];

function parseModelIds(raw: string): number[] {
  const ids = raw.split(",").map((s) => Number(s.trim()));
  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new Error(`--models: oczekiwano listy dodatnich id oddzielonych przecinkiem, otrzymano "${raw}"`);
  return ids;
}

// npm uruchamia skrypt z cwd=packages/api (workspace @dex-arb/api), więc domyślny `--out results`
// bez rozwiązania względem korzenia repo tworzyłby packages/api/results/ zamiast results/ w korzeniu.
function resolveOut(rawOut: string): string {
  if (isAbsolute(rawOut)) return rawOut;
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    if (root) return join(root, rawOut);
  } catch {
    // brak repo git (np. archiwum bez .git) — zostajemy przy cwd
  }
  return join(process.cwd(), rawOut);
}

async function loadModels(db: Db): Promise<ScoringModelRow[]> {
  return (await db.execute(sql`SELECT id, name, kind, version, metrics, trained_on_window_ids FROM scoring_models ORDER BY id`)) as unknown as ScoringModelRow[];
}

async function loadWindows(db: Db): Promise<WindowRow[]> {
  return (await db.execute(sql`SELECT id, name, from_block::int AS from_block, to_block::int AS to_block FROM windows ORDER BY from_ts`)) as unknown as WindowRow[];
}

function seedOf(model: ScoringModelRow): number | null {
  if (model.kind !== "anfis") return null;
  const parsed = AnfisMetricsReadSchema.safeParse(model.metrics);
  return parsed.success && parsed.data.seed !== undefined ? parsed.data.seed : null;
}

/** Analiza wrażliwości: warianty populacji × okna × wybrane modele → `evaluation-sensitivity.*`
 * (ta sama `evaluateModelOnWindow`, tylko z parametrem `variant`). Modele spoza `modelIds` i
 * komórki bez populacji (n = 0) są pomijane; brak któregoś z żądanych id to błąd (żeby tabela nie
 * była po cichu niepełna). */
async function exportSensitivity(db: Db, out: string, models: ScoringModelRow[], targets: ({ id: number; name: string } | null)[], modelIds: number[], meta: { gitSha: string; createdAt: string; latex: boolean }): Promise<void> {
  const byId = new Map(models.map((m) => [m.id, m]));
  const missing = modelIds.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error(`--models: brak modeli o id ${missing.join(", ")} w scoring_models`);
  const rows: SensitivityRow[] = [];
  for (const id of modelIds) {
    const m = byId.get(id)!;
    for (const w of targets) {
      for (const v of POPULATION_VARIANTS) {
        const ev = await evaluateModelOnWindow(db, m, w, v.key);
        if (ev.n === 0) continue;
        rows.push({
          variant: v.key, variant_label: v.label,
          model_id: m.id, name: m.name, kind: m.kind, version: m.version, seed: seedOf(m),
          window_id: w?.id ?? null, window_name: w?.name ?? "wszystkie (2–5)",
          n: ev.n, n_positive: ev.n_positive,
          auc: ev.auc, auc_ci_low: ev.auc_ci95?.[0] ?? null, auc_ci_high: ev.auc_ci95?.[1] ?? null, pr_auc: ev.pr_auc,
          precision: ev.precision, recall: ev.recall, f1: ev.f1,
          tp: ev.confusion.tp, fp: ev.confusion.fp, tn: ev.confusion.tn, fn: ev.confusion.fn,
          threshold: SCORE_THRESHOLD, threshold_train_opt: ev.threshold_train_opt ?? null,
          is_train_window: w !== null && (m.trained_on_window_ids ?? []).includes(w.id),
        });
        console.error(`wrażliwość: ${v.label} × model ${m.id} (${m.name} v${m.version}) × ${w?.name ?? "wszystkie"} — n=${ev.n}, n_pos=${ev.n_positive}`);
      }
    }
  }
  writeFileSync(join(out, "evaluation-sensitivity.csv"), toCsv(rows as unknown as Record<string, unknown>[], [...SENSITIVITY_COLUMNS]));
  writeFileSync(join(out, "evaluation-sensitivity.md"), sensitivityMarkdown(rows, meta));
  if (meta.latex) writeFileSync(join(out, "evaluation-sensitivity.tex"), sensitivityLatex(rows));
  console.error(`zapisano ${rows.length} wierszy analizy wrażliwości do ${out}/`);
}

async function main(): Promise<void> {
  const latex = process.argv.includes("--latex");
  const sensitivityOnly = process.argv.includes("--sensitivity-only");
  const modelIds = parseModelIds(argValue("--models", SENSITIVITY_MODEL_IDS.join(",")));
  const out = resolveOut(argValue("--out", "results"));
  mkdirSync(out, { recursive: true });
  const { db, sql: client } = createDb();
  const startedAt = new Date().toISOString();
  try {
    const models = await loadModels(db);
    const windows = (await loadWindows(db)).filter((w) => w.from_block !== null && w.to_block !== null);
    const targets: ({ id: number; name: string } | null)[] = [...windows.map((w) => ({ id: w.id, name: w.name })), null];

    if (sensitivityOnly) {
      await exportSensitivity(db, out, models, targets, modelIds, { gitSha: gitSha(), createdAt: startedAt, latex });
      return;
    }

    const rows: EvaluationRow[] = [];
    for (const m of models) {
      for (const w of targets) {
        const ev = await evaluateModelOnWindow(db, m, w);
        if (ev.n === 0) continue;
        rows.push({
          model_id: m.id, name: m.name, kind: m.kind, version: m.version, seed: seedOf(m),
          window_id: w?.id ?? null, window_name: w?.name ?? "wszystkie (2–5)",
          n: ev.n, n_positive: ev.n_positive,
          auc: ev.auc, auc_ci_low: ev.auc_ci95?.[0] ?? null, auc_ci_high: ev.auc_ci95?.[1] ?? null, pr_auc: ev.pr_auc,
          precision: ev.precision, recall: ev.recall, f1: ev.f1,
          tp: ev.confusion.tp, fp: ev.confusion.fp, tn: ev.confusion.tn, fn: ev.confusion.fn,
          threshold: SCORE_THRESHOLD, threshold_train_opt: ev.threshold_train_opt ?? null,
          is_train_window: w !== null && (m.trained_on_window_ids ?? []).includes(w.id),
        });
        writeFileSync(join(out, `roc-${m.id}-${w?.id ?? "all"}.csv`), toCsv(ev.roc.fpr.map((f, i) => ({ fpr: f, tpr: ev.roc.tpr[i] })), ["fpr", "tpr"]));
        console.error(`ewaluacja: model ${m.id} (${m.name} v${m.version}) × ${w?.name ?? "wszystkie"} — n=${ev.n}`);
      }
    }
    const columns = ["model_id", "name", "kind", "version", "seed", "window_id", "window_name", "n", "n_positive", "auc", "auc_ci_low", "auc_ci_high", "pr_auc", "precision", "recall", "f1", "tp", "fp", "tn", "fn", "threshold", "threshold_train_opt", "is_train_window"];
    writeFileSync(join(out, "evaluation.csv"), toCsv(rows as unknown as Record<string, unknown>[], columns));
    const seeds = aggregateSeeds(rows);
    writeFileSync(join(out, "evaluation-seeds.csv"), toCsv(seeds as unknown as Record<string, unknown>[], ["name", "window_id", "window_name", "n_models", "auc_mean", "auc_sd", "pr_auc_mean", "pr_auc_sd"]));
    const sha = gitSha();
    writeFileSync(join(out, "evaluation.md"), evaluationMarkdown(mainTableRows(rows), seeds, { gitSha: sha, createdAt: startedAt }));
    if (latex) writeFileSync(join(out, "evaluation.tex"), evaluationLatex(mainTableRows(rows), seeds));

    // pokrycie (ta sama SQL co GET /coverage)
    const cells = await loadCoverage(db);
    const pairs = (await db.execute(sql`SELECT id, symbol FROM pairs`)) as unknown as { id: number; symbol: string }[];
    const pairName = new Map(pairs.map((p) => [p.id, p.symbol]));
    const windowName = new Map(windows.map((w) => [w.id, w.name]));
    const oppMap = await loadOpportunityCounts(db);
    const coverageRows = cells.flatMap((c) => c.pools.map((p) => ({
      pair_id: c.pair_id, pair: pairName.get(c.pair_id) ?? "", window_id: c.window_id, window: windowName.get(c.window_id) ?? "",
      pool_id: p.pool_id, dex: p.dex_name, done_blocks: p.done_blocks, total_blocks: p.total_blocks, coverage_pct: p.coverage_pct,
      block_states: c.block_states, opportunities: oppMap.get(`${c.pair_id}:${c.window_id}`) ?? 0,
    })));
    writeFileSync(join(out, "coverage.csv"), toCsv(coverageRows, ["pair_id", "pair", "window_id", "window", "pool_id", "dex", "done_blocks", "total_blocks", "coverage_pct", "block_states", "opportunities"]));

    // statystyki weryfikacji per okno × para
    const verif = (await db.execute(sql`
      SELECT o.window_id, w.name AS window, o.pair_id, p.symbol AS pair,
        count(*)::int AS opportunities,
        count(*) FILTER (WHERE ov.status = 'consumed_atomic')::int AS consumed_atomic,
        count(*) FILTER (WHERE ov.status = 'consumed_atomic' AND ov.gas_cost_usd = 0)::int AS zero_gas_consumers,
        count(*) FILTER (WHERE ov.status = 'consumed_partial')::int AS consumed_partial,
        count(*) FILTER (WHERE ov.status = 'decayed')::int AS decayed,
        count(*) FILTER (WHERE ov.status = 'persisted')::int AS persisted,
        count(*) FILTER (WHERE ov.route = 'two_pool')::int AS two_pool,
        count(*) FILTER (WHERE ov.route = 'multi')::int AS multi,
        count(*) FILTER (WHERE ov.profitable_consumed)::int AS profitable,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY ov.realized_profit_usd) FILTER (WHERE ov.route = 'two_pool') AS profit_median_usd,
        avg(ov.realized_profit_usd) FILTER (WHERE ov.route = 'two_pool') AS profit_mean_usd,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY ov.gas_cost_usd) FILTER (WHERE ov.status = 'consumed_atomic') AS gas_median_usd
      FROM opportunities o
      JOIN windows w ON w.id = o.window_id
      JOIN pairs p ON p.id = o.pair_id
      LEFT JOIN opportunity_verifications ov ON ov.opportunity_id = o.id
      GROUP BY 1, 2, 3, 4 ORDER BY 1, 3
    `)) as unknown as Record<string, unknown>[];
    writeFileSync(join(out, "verification-stats.csv"), toCsv(verif, [...VERIFICATION_STATS_COLUMNS]));

    // koszt obliczeniowy zadań
    const jobs = (await db.execute(sql`
      SELECT type, count(*)::int AS n_done,
        round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM finished_at - started_at))::numeric, 1) AS duration_median_s,
        round(avg(extract(epoch FROM finished_at - started_at))::numeric, 1) AS duration_mean_s
      FROM jobs WHERE status = 'done' AND started_at IS NOT NULL AND finished_at IS NOT NULL
      GROUP BY type ORDER BY type
    `)) as unknown as Record<string, unknown>[];
    writeFileSync(join(out, "jobs-stats.csv"), toCsv(jobs, ["type", "n_done", "duration_median_s", "duration_mean_s"]));

    writeFileSync(join(out, "constants.md"), constantsMarkdown(CONSTANT_TABLE));

    const provenance = {
      gitSha: sha, createdAt: startedAt, nodeVersion: process.version, rpcHost: rpcHostFrom(process.env.RPC_URL),
      deps: { "@thi.ng/fuzzy": packageVersion("@thi.ng/fuzzy"), "drizzle-orm": packageVersion("drizzle-orm"), zod: packageVersion("zod"), fastify: packageVersion("fastify") },
      tables: await tableCounts(db, ["blocks", "sync_events", "swap_events", "block_states", "opportunities", "opportunity_verifications", "scoring_models", "model_scores", "jobs"]),
      windows: windows.map((w) => ({ id: w.id, name: w.name, from_block: w.from_block, to_block: w.to_block })),
    };
    writeFileSync(join(out, "provenance.json"), JSON.stringify(provenance, null, 2) + "\n");
    console.error(`zapisano ${rows.length} wierszy ewaluacji do ${out}/`);

    await exportSensitivity(db, out, models, targets, modelIds, { gitSha: sha, createdAt: startedAt, latex });
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => {
  console.error("BŁĄD:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
