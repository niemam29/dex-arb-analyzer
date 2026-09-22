import { describe, expect, it } from "vitest";
import { SENSITIVITY_COLUMNS, VERIFICATION_STATS_COLUMNS, aggregateSeeds, constantsMarkdown, evaluationLatex, evaluationMarkdown, mainTableRows, sensitivityLatex, sensitivityMarkdown, texEsc, toCsv, type EvaluationRow, type SensitivityRow } from "../scripts/export-results-format.js";
import { POPULATION_VARIANTS } from "../src/queries/evaluation.sql.js";

const row = (o: Partial<EvaluationRow>): EvaluationRow => ({
  model_id: 1, name: "baseline", kind: "baseline", version: 1, seed: null, window_id: 2, window_name: "2021-05 krach",
  n: 2118, n_positive: 477, auc: 0.627, auc_ci_low: 0.6, auc_ci_high: 0.65, pr_auc: 0.3, precision: 0.536, recall: 0.109, f1: 0.181,
  tp: 52, fp: 45, tn: 1596, fn: 425, threshold: 50, threshold_train_opt: null, is_train_window: false, ...o,
});

describe("toCsv", () => {
  it("nagłówek z kolumn, cudzysłowy przy przecinku/cudzysłowie, null -> puste, kropka dziesiętna", () => {
    const csv = toCsv([{ a: 1.5, b: 'x,"y"', c: null }], ["a", "b", "c"]);
    expect(csv).toBe('a,b,c\n1.5,"x,""y""",\n');
  });
});

describe("VERIFICATION_STATS_COLUMNS", () => {
  it("niesie zero_gas_consumers zaraz po consumed_atomic (pakiety Flashbots, docs/methodology.md §6c)", () => {
    expect(VERIFICATION_STATS_COLUMNS).toContain("zero_gas_consumers");
    const i = VERIFICATION_STATS_COLUMNS.indexOf("consumed_atomic");
    expect(VERIFICATION_STATS_COLUMNS[i + 1]).toBe("zero_gas_consumers");
  });
});

describe("mainTableRows / aggregateSeeds", () => {
  const rows = [
    row({ model_id: 1 }),
    row({ model_id: 10, name: "anfis-w2", kind: "anfis", version: 1, seed: 43, auc: 0.70, pr_auc: 0.30 }),
    row({ model_id: 11, name: "anfis-w2", kind: "anfis", version: 2, seed: 42, auc: 0.72, pr_auc: 0.34 }),
    row({ model_id: 12, name: "anfis-w2", kind: "anfis", version: 3, seed: 44, auc: 0.74, pr_auc: 0.32 }),
    row({ model_id: 13, name: "anfis-w2", kind: "anfis", version: 2, seed: 42, window_id: 3, window_name: "2021-11 ATH", auc: 0.8 }),
    // Brak wiersza seed=42 dla tej nazwy -> fallback na najniższą wersję (model 20).
    row({ model_id: 20, name: "anfis-w2w4", kind: "anfis", version: 5, seed: 43, window_id: 4, window_name: "2022-05 Luna", auc: 0.75 }),
    row({ model_id: 21, name: "anfis-w2w4", kind: "anfis", version: 6, seed: 44, window_id: 4, window_name: "2022-05 Luna", auc: 0.77 }),
  ];
  it("tabela główna: nie-anfis + wiersz seed=42 każdej nazwy anfis (per okno); bez seed=42 -> najniższa wersja", () => {
    expect(mainTableRows(rows).map((r) => r.model_id)).toEqual([1, 11, 13, 20]);
  });
  it("agregacja seedów: mean ± sd (n−1) po (name, window), tylko grupy ≥ 2 modeli", () => {
    const agg = aggregateSeeds(rows);
    expect(agg).toHaveLength(2);
    expect(agg[0]).toMatchObject({ name: "anfis-w2", window_id: 2, n_models: 3 });
    expect(agg[0]!.auc_mean).toBeCloseTo(0.72, 12);
    expect(agg[0]!.auc_sd).toBeCloseTo(0.02, 12);
    expect(agg[0]!.pr_auc_mean).toBeCloseTo(0.32, 12);
    expect(agg[1]).toMatchObject({ name: "anfis-w2w4", window_id: 4, n_models: 2 });
    expect(agg[1]!.auc_mean).toBeCloseTo(0.76, 12);
  });
});

describe("evaluationMarkdown / evaluationLatex / constantsMarkdown", () => {
  it("markdown: komentarz generated z sha, wiersz z AUC [CI] i PR-AUC, sekcja seedów", () => {
    const md = evaluationMarkdown([row({})], [{ name: "anfis-w2", window_id: 2, window_name: "2021-05 krach", n_models: 5, auc_mean: 0.71, auc_sd: 0.01, pr_auc_mean: 0.3, pr_auc_sd: 0.02 }], { gitSha: "abc123", createdAt: "2026-08-28T10:00:00.000Z" });
    expect(md).toContain("<!-- generated: npm run export-results @ abc123 2026-08-28T10:00:00.000Z -->");
    expect(md).toContain("| 2021-05 krach | baseline (1) | 2118 | 477 | 52 | 45 | 1596 | 425 | 0,536 | 0,109 | 0,181 | 0,300 | 0,627 [0,60–0,65] |");
    expect(md).toContain("| anfis-w2 | 2021-05 krach | 5 | 0,710 ± 0,010 | 0,300 ± 0,020 |");
  });
  it("latex: booktabs, wiersz zakończony \\\\, separator dziesiętny przecinek w {}", () => {
    const tex = evaluationLatex([row({})], []);
    expect(tex).toContain("\\toprule");
    expect(tex).toContain("2021-05 krach & baseline (1) & 2118 & 477 & 0{,}536 & 0{,}109 & 0{,}181 & 0{,}300 & 0{,}627 [0{,}60--0{,}65] \\\\");
    expect(tex).toContain("\\bottomrule");
  });
  it("constantsMarkdown: jedna linia na stałą", () => {
    const md = constantsMarkdown([{ name: "ARB_GAS", value: 220000, unit: "gaz", rationale: "x", usedIn: "f.ts" }]);
    expect(md).toContain("| `ARB_GAS` | 220000 | gaz | x | `f.ts` |");
  });
  it("markdown: znacznik (tr) przy modelu, gdy window_id jest oknem treningowym", () => {
    const md = evaluationMarkdown([row({ is_train_window: true })], [], { gitSha: "abc123", createdAt: "2026-08-28T10:00:00.000Z" });
    expect(md).toContain("| 2021-05 krach | baseline (1) (tr) | 2118");
  });
  it("markdown: uwaga o formacie liczb (CSV kropka, MD/LaTeX przecinek)", () => {
    const md = evaluationMarkdown([row({})], [], { gitSha: "abc123", createdAt: "2026-08-28T10:00:00.000Z" });
    expect(md).toContain("CSV");
    expect(md).toContain("przecinek dziesiętny");
  });
});

describe("texEsc", () => {
  it("ucieka znaki specjalne LaTeX-a (& % _ #)", () => {
    expect(texEsc("a&b%c_d#e")).toBe("a\\&b\\%c\\_d\\#e");
  });
  it("nie zmienia tekstu bez znaków specjalnych", () => {
    expect(texEsc("anfis-w2")).toBe("anfis-w2");
  });
});

describe("sensitivityMarkdown / sensitivityLatex / SENSITIVITY_COLUMNS", () => {
  const srow = (o: Partial<SensitivityRow>): SensitivityRow => ({ ...row({}), variant: "full", variant_label: "pełna", ...o });
  const rows = [
    srow({}),
    srow({ variant: "bot_first", variant_label: "bot pierwszy", n: 1800, n_positive: 150, auc: 0.702, auc_ci_low: 0.66, auc_ci_high: 0.74, pr_auc: 0.25 }),
  ];
  it("CSV: wariant jako pierwsze kolumny, bez seed/threshold_train_opt", () => {
    expect(SENSITIVITY_COLUMNS.slice(0, 2)).toEqual(["variant", "variant_label"]);
    expect(SENSITIVITY_COLUMNS).not.toContain("seed");
    expect(SENSITIVITY_COLUMNS).not.toContain("threshold_train_opt");
    const csv = toCsv(rows as unknown as Record<string, unknown>[], [...SENSITIVITY_COLUMNS]);
    expect(csv.split("\n")[1]!.startsWith("full,pełna,1,baseline,")).toBe(true);
  });
  it("MD: definicja każdego wariantu w nagłówku (jedno zdanie), wiersz z etykietą wariantu i przecinkiem dziesiętnym", () => {
    const md = sensitivityMarkdown(rows, { gitSha: "abc", createdAt: "2026-09-09T00:00:00Z" });
    expect(md).toContain("<!-- generated: npm run export-results -- --sensitivity-only @ abc 2026-09-09T00:00:00Z -->");
    for (const v of POPULATION_VARIANTS) {
      expect(md).toContain(`- **${v.label}** (\`${v.key}\`): ${v.definition}`);
      // jedno zdanie: dokładnie jedna kropka kończąca, bez kropki w środku zdania
      expect(v.definition.trim().endsWith(".")).toBe(true);
      expect(v.definition.trim().slice(0, -1)).not.toMatch(/\.\s/);
    }
    expect(md).toContain("| bot pierwszy | 2021-05 krach | baseline (1) | 1800 | 150 | 52 | 45 | 1596 | 425 | 0,536 | 0,109 | 0,181 | 0,250 | 0,702 [0,66–0,74] |");
    expect(md).toContain("| pełna | 2021-05 krach | baseline (1) | 2118 | 477 |");
  });
  it("LaTeX: kolumna Wariant, definicje wariantów w komentarzach, booktabs", () => {
    const tex = sensitivityLatex(rows);
    expect(tex).toContain("\\begin{tabular}{lllrrrrrrr}");
    expect(tex).toContain("Wariant & Okno & Model (id)");
    expect(tex).toContain("bot pierwszy & 2021-05 krach & baseline (1) & 1800 & 150 & 0{,}536 & 0{,}109 & 0{,}181 & 0{,}250 & 0{,}702 [0{,}66--0{,}74] \\\\");
    for (const v of POPULATION_VARIANTS) expect(tex).toContain(`% wariant ${v.label} (${v.key}):`);
    expect(tex).toContain("\\bottomrule");
  });
});
