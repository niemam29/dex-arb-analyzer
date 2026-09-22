// Czyste formatery eksportu wyników (CSV/Markdown/LaTeX) — bez I/O, testowane w
// test/export-results-format.test.ts. Liczby w MD/LaTeX z przecinkiem dziesiętnym (praca po polsku).
import type { ConstantDef } from "@dex-arb/core";
import { POPULATION_VARIANTS, type PopulationVariant } from "../src/queries/evaluation.sql.js";

/** Kolumny `results/verification-stats.csv` (export-results.ts) — `zero_gas_consumers` liczy wiersze
 * `status = 'consumed_atomic'` z `gas_cost_usd = 0` (pakiety Flashbots bez jawnego kosztu gazu w tx,
 * patrz `docs/methodology.md` §6c). Wydzielone jako stała, żeby lista kolumn była testowana. */
export const VERIFICATION_STATS_COLUMNS = [
  "window_id", "window", "pair_id", "pair", "opportunities",
  "consumed_atomic", "zero_gas_consumers", "consumed_partial", "decayed", "persisted",
  "two_pool", "multi", "profitable", "profit_median_usd", "profit_mean_usd", "gas_median_usd",
] as const;

export interface EvaluationRow {
  model_id: number; name: string; kind: string; version: number; seed: number | null;
  window_id: number | null; window_name: string;
  n: number; n_positive: number;
  auc: number | null; auc_ci_low: number | null; auc_ci_high: number | null; pr_auc: number | null;
  precision: number; recall: number; f1: number;
  tp: number; fp: number; tn: number; fn: number;
  threshold: number; threshold_train_opt: number | null;
  /** `true`, gdy `window_id` należy do `scoring_models.trained_on_window_ids` tego modelu — wiersz jest in-sample, oznaczany `(tr)` w MD/LaTeX. */
  is_train_window: boolean;
}

/** Wiersz analizy wrażliwości (`results/evaluation-sensitivity.*`): ewaluacja jak w tabeli głównej,
 * ale na populacji wariantu `variant` (`POPULATION_VARIANTS`, evaluation.sql.ts). */
export interface SensitivityRow extends EvaluationRow {
  variant: PopulationVariant;
  variant_label: string;
}

/** Kolumny `results/evaluation-sensitivity.csv` — bez `seed`/`threshold_train_opt` (to nie porównanie
 * seedów ani progów, tylko wrażliwość metryk na definicję populacji). */
export const SENSITIVITY_COLUMNS = [
  "variant", "variant_label", "model_id", "name", "kind", "version", "window_id", "window_name",
  "n", "n_positive", "auc", "auc_ci_low", "auc_ci_high", "pr_auc", "precision", "recall", "f1",
  "tp", "fp", "tn", "fn", "threshold", "is_train_window",
] as const;

export interface SeedAggregate {
  name: string; window_id: number | null; window_name: string; n_models: number;
  auc_mean: number | null; auc_sd: number | null; pr_auc_mean: number | null; pr_auc_sd: number | null;
}

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? String(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(","));
  return lines.join("\n") + "\n";
}

/** Dla każdej nazwy ANFIS wybiera JEDNĄ wersję do tabeli głównej: preferuje `seed === 42`
 * (reprodukowalny, dokumentowany domyślny seed treningu — `docs/anfis.md`); gdy dla danej
 * nazwy nie ma wiersza z seed 42 (np. model wytrenowany innym seedem bez rerunu), spada do
 * najniższej wersji tej nazwy. Nie-ANFIS przechodzą bez zmian. */
export function mainTableRows(rows: EvaluationRow[]): EvaluationRow[] {
  const minVersion = new Map<string, number>();
  const seed42Version = new Map<string, number>();
  for (const r of rows) {
    if (r.kind !== "anfis") continue;
    const cur = minVersion.get(r.name);
    if (cur === undefined || r.version < cur) minVersion.set(r.name, r.version);
    if (r.seed === 42) {
      const s = seed42Version.get(r.name);
      if (s === undefined || r.version < s) seed42Version.set(r.name, r.version);
    }
  }
  const chosenVersion = (name: string): number | undefined => seed42Version.get(name) ?? minVersion.get(name);
  return rows.filter((r) => r.kind !== "anfis" || r.version === chosenVersion(r.name));
}

function meanSd(values: number[]): { mean: number | null; sd: number | null } {
  if (values.length === 0) return { mean: null, sd: null };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 2) return { mean, sd: null };
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1));
  return { mean, sd };
}

export function aggregateSeeds(rows: EvaluationRow[]): SeedAggregate[] {
  const groups = new Map<string, EvaluationRow[]>();
  for (const r of rows) {
    if (r.kind !== "anfis") continue;
    const k = `${r.name}|${r.window_id ?? "all"}`;
    const arr = groups.get(k);
    if (arr) arr.push(r);
    else groups.set(k, [r]);
  }
  const out: SeedAggregate[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const auc = meanSd(g.map((r) => r.auc).filter((v): v is number => v !== null));
    const pr = meanSd(g.map((r) => r.pr_auc).filter((v): v is number => v !== null));
    const first = g[0]!;
    out.push({ name: first.name, window_id: first.window_id, window_name: first.window_name, n_models: g.length, auc_mean: auc.mean, auc_sd: auc.sd, pr_auc_mean: pr.mean, pr_auc_sd: pr.sd });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || (a.window_id ?? 1e9) - (b.window_id ?? 1e9));
}

const pl = (v: number | null, d: number): string => (v === null ? "—" : v.toFixed(d).replace(".", ","));
const aucCell = (r: EvaluationRow): string => (r.auc === null ? "—" : r.auc_ci_low !== null && r.auc_ci_high !== null ? `${pl(r.auc, 3)} [${pl(r.auc_ci_low, 2)}–${pl(r.auc_ci_high, 2)}]` : pl(r.auc, 3));
const label = (r: EvaluationRow): string => `${r.name} (${r.model_id})${r.is_train_window ? " (tr)" : ""}`;

export function evaluationMarkdown(rows: EvaluationRow[], seeds: SeedAggregate[], meta: { gitSha: string; createdAt: string }): string {
  const out: string[] = [];
  out.push(`<!-- generated: npm run export-results @ ${meta.gitSha} ${meta.createdAt} -->`);
  out.push("");
  out.push("Populacja: zweryfikowane okazje o znanej etykiecie (`route IS NULL OR route <> 'multi'`), wszystkie pary; próg klasyfikacji 50; AUC z 95 % przedziałem ufności (bootstrap stratyfikowany, 1000 prób, seed 42); PR-AUC = average precision. `(tr)` = okno użyte do treningu/kalibracji.");
  out.push("");
  out.push("Uwaga o formacie liczb: pliki CSV używają kropki dziesiętnej (RFC 4180); w tym dokumencie i w LaTeX-u liczby mają przecinek dziesiętny (pl-PL).");
  out.push("");
  out.push("| Okno | Model (id) | n | n_pos | TP | FP | TN | FN | Precision | Recall | F1 | PR-AUC | AUC [95 % CI] |");
  out.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    out.push(`| ${r.window_name} | ${label(r)} | ${r.n} | ${r.n_positive} | ${r.tp} | ${r.fp} | ${r.tn} | ${r.fn} | ${pl(r.precision, 3)} | ${pl(r.recall, 3)} | ${pl(r.f1, 3)} | ${pl(r.pr_auc, 3)} | ${aucCell(r)} |`);
  }
  if (seeds.length > 0) {
    out.push("");
    out.push("## Stabilność ANFIS między seedami");
    out.push("");
    out.push("| Model | Okno | n modeli | AUC (mean ± sd) | PR-AUC (mean ± sd) |");
    out.push("|---|---|---|---|---|");
    for (const s of seeds) {
      out.push(`| ${s.name} | ${s.window_name} | ${s.n_models} | ${pl(s.auc_mean, 3)} ± ${pl(s.auc_sd, 3)} | ${pl(s.pr_auc_mean, 3)} ± ${pl(s.pr_auc_sd, 3)} |`);
    }
  }
  return out.join("\n") + "\n";
}

const tex = (v: number | null, d: number): string => (v === null ? "---" : v.toFixed(d).replace(".", "{,}"));
/** Ucieczka znaków specjalnych LaTeX-a w tekście (nazwy modeli/okien pochodzą z bazy, nie z kodu). */
export const texEsc = (s: string): string => s.replace(/[&%_#]/g, (m) => `\\${m}`);

export function evaluationLatex(rows: EvaluationRow[], seeds: SeedAggregate[]): string {
  const out: string[] = [];
  out.push("% wygenerowane przez `npm run export-results -- --latex`; wymaga \\usepackage{booktabs}");
  out.push("\\begin{tabular}{llrrrrrrr}");
  out.push("\\toprule");
  out.push("Okno & Model (id) & $n$ & $n_{pos}$ & Precision & Recall & F1 & PR-AUC & AUC [95\\,\\% CI] \\\\");
  out.push("\\midrule");
  for (const r of rows) {
    const auc = r.auc === null ? "---" : r.auc_ci_low !== null && r.auc_ci_high !== null ? `${tex(r.auc, 3)} [${tex(r.auc_ci_low, 2)}--${tex(r.auc_ci_high, 2)}]` : tex(r.auc, 3);
    out.push(`${texEsc(r.window_name)} & ${texEsc(label(r))} & ${r.n} & ${r.n_positive} & ${tex(r.precision, 3)} & ${tex(r.recall, 3)} & ${tex(r.f1, 3)} & ${tex(r.pr_auc, 3)} & ${auc} \\\\`);
  }
  out.push("\\bottomrule");
  out.push("\\end{tabular}");
  if (seeds.length > 0) {
    out.push("");
    out.push("\\begin{tabular}{llrrr}");
    out.push("\\toprule");
    out.push("Model & Okno & $n$ modeli & AUC (mean $\\pm$ sd) & PR-AUC (mean $\\pm$ sd) \\\\");
    out.push("\\midrule");
    for (const s of seeds) out.push(`${texEsc(s.name)} & ${texEsc(s.window_name)} & ${s.n_models} & ${tex(s.auc_mean, 3)} $\\pm$ ${tex(s.auc_sd, 3)} & ${tex(s.pr_auc_mean, 3)} $\\pm$ ${tex(s.pr_auc_sd, 3)} \\\\`);
    out.push("\\bottomrule");
    out.push("\\end{tabular}");
  }
  return out.join("\n") + "\n";
}

/** Nagłówek tabeli wrażliwości: jedno zdanie definicji na wariant (wspólne dla MD i LaTeX-a). */
const variantDefinitionLines = (): string[] => POPULATION_VARIANTS.map((v) => `- **${v.label}** (\`${v.key}\`): ${v.definition}`);

export function sensitivityMarkdown(rows: SensitivityRow[], meta: { gitSha: string; createdAt: string }): string {
  const out: string[] = [];
  out.push(`<!-- generated: npm run export-results -- --sensitivity-only @ ${meta.gitSha} ${meta.createdAt} -->`);
  out.push("");
  out.push("Analiza wrażliwości protokołu ewaluacji (`docs/methodology.md` §5) na definicję populacji pozytywów. Każdy wariant to populacja z ADR 0008 (zweryfikowane okazje o znanej etykiecie, wszystkie pary) z dodatkowym ograniczeniem; te same funkcje metryk co `results/evaluation.md`: próg klasyfikacji 50; AUC z 95 % przedziałem ufności (bootstrap stratyfikowany, 1000 prób, seed 42); PR-AUC = average precision. `(tr)` = okno użyte do treningu/kalibracji.");
  out.push("");
  out.push("Warianty populacji:");
  out.push("");
  out.push(...variantDefinitionLines());
  out.push("");
  out.push("Uwaga o formacie liczb: pliki CSV używają kropki dziesiętnej (RFC 4180); w tym dokumencie i w LaTeX-u liczby mają przecinek dziesiętny (pl-PL).");
  out.push("");
  out.push("| Wariant | Okno | Model (id) | n | n_pos | TP | FP | TN | FN | Precision | Recall | F1 | PR-AUC | AUC [95 % CI] |");
  out.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    out.push(`| ${r.variant_label} | ${r.window_name} | ${label(r)} | ${r.n} | ${r.n_positive} | ${r.tp} | ${r.fp} | ${r.tn} | ${r.fn} | ${pl(r.precision, 3)} | ${pl(r.recall, 3)} | ${pl(r.f1, 3)} | ${pl(r.pr_auc, 3)} | ${aucCell(r)} |`);
  }
  return out.join("\n") + "\n";
}

export function sensitivityLatex(rows: SensitivityRow[]): string {
  const out: string[] = [];
  out.push("% wygenerowane przez `npm run export-results -- --sensitivity-only --latex`; wymaga \\usepackage{booktabs}");
  for (const v of POPULATION_VARIANTS) out.push(`% wariant ${v.label} (${v.key}): ${v.definition}`);
  out.push("\\begin{tabular}{lllrrrrrrr}");
  out.push("\\toprule");
  out.push("Wariant & Okno & Model (id) & $n$ & $n_{pos}$ & Precision & Recall & F1 & PR-AUC & AUC [95\\,\\% CI] \\\\");
  out.push("\\midrule");
  for (const r of rows) {
    const auc = r.auc === null ? "---" : r.auc_ci_low !== null && r.auc_ci_high !== null ? `${tex(r.auc, 3)} [${tex(r.auc_ci_low, 2)}--${tex(r.auc_ci_high, 2)}]` : tex(r.auc, 3);
    out.push(`${texEsc(r.variant_label)} & ${texEsc(r.window_name)} & ${texEsc(label(r))} & ${r.n} & ${r.n_positive} & ${tex(r.precision, 3)} & ${tex(r.recall, 3)} & ${tex(r.f1, 3)} & ${tex(r.pr_auc, 3)} & ${auc} \\\\`);
  }
  out.push("\\bottomrule");
  out.push("\\end{tabular}");
  return out.join("\n") + "\n";
}

export function constantsMarkdown(table: readonly ConstantDef[]): string {
  const out = ["| Stała | Wartość | Jednostka | Uzasadnienie | Użycie |", "|---|---|---|---|---|"];
  for (const c of table) out.push(`| \`${c.name}\` | ${c.value} | ${c.unit} | ${c.rationale} | \`${c.usedIn}\` |`);
  return out.join("\n") + "\n";
}
