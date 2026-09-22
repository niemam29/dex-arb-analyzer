// Ocena bloków modelami baseline/mamdani — funkcje czyste (scoreRows, labelDistribution).
// Zapis do bazy (ensureScoringModels, writeModelScores) żyje w `db.ts`, jedynym module z
// SQL-em dla block_states/opportunities/model_scores; ModelEntry/ModelScoreRow re-eksportowane
// stąd, bo scoreRows/labelDistribution ich używają w swoich sygnaturach.
import type { Features, Label } from "@dex-arb/core";
import { LABELS } from "@dex-arb/core";
import type { BlockStateRow } from "./analyzeWindow.js";
import type { ModelEntry, ModelScoreRow } from "./db.js";

export type { ModelEntry, ModelScoreRow } from "./db.js";

const toFeatures = (r: BlockStateRow): Features => ({
  S: r.s,
  G: r.g,
  L: r.l,
  M: r.m,
  netProfitUsd: r.baselineNetProfitUsd,
  grossProfitUsd: r.grossProfitUsd,
  optTradeUsd: r.optTradeUsd,
});

/** Ocena bloków JEDNYM zbudowanym modelem (patrz ensureScoringModels) — bez budowania per wiersz. */
export function scoreRows(rows: BlockStateRow[], m: ModelEntry): ModelScoreRow[] {
  return rows.map((r) => {
    const s = m.model.score(toFeatures(r));
    return { modelId: m.id, pairId: r.pairId, block: r.block, score: s.score, label: s.label };
  });
}

/** Udziały procentowe czterech etykiet LABELS w zbiorze wyników (0 dla pustej tablicy). */
export function labelDistribution(rows: ModelScoreRow[]): Record<Label, number> {
  const d = Object.fromEntries(LABELS.map((l) => [l, 0])) as Record<Label, number>;
  for (const r of rows) d[r.label]++;
  for (const l of LABELS) d[l] = rows.length ? (100 * d[l]) / rows.length : 0;
  return d;
}
