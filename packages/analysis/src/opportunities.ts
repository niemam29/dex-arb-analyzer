// Wykrywanie okazji arbitrażowych — funkcja czysta, bez dostępu do bazy. Zapis (writeOpportunities)
// żyje w `db.ts`, jedynym module z SQL-em dla block_states/opportunities/model_scores.
import { SPREAD_THRESHOLD_PCT } from "@dex-arb/shared";
import type { BlockStateRow } from "./analyzeWindow.js";

/**
 * Próg spreadu [%], POWYŻEJ którego blok liczy się jako okazja (ostro, wg progu z modelu FIS).
 * Alias `SPREAD_THRESHOLD_PCT` z `@dex-arb/shared` — kanoniczna wartość jest tam, żeby
 * API/dashboard mogły ją odczytać bez zależności od `@dex-arb/analysis`.
 */
export const OPPORTUNITY_THRESHOLD_PCT = SPREAD_THRESHOLD_PCT;

export interface OpportunityRow {
  pairId: number;
  windowId: number;
  block: number;
  spreadPct: number;
  direction: "a->b" | "b->a";
  estProfitUsd: number;
}

/**
 * Bloki ze spreadem > próg. Kierunek: z `BlockStateRow.direction`, gdy `arbitrage()` go
 * wyznaczył; gdy dał "none" (np. bardzo płytka pula — brak opłacalnego kierunku wg formuły
 * zamkniętej, ale spread mimo to przekracza próg), kierunek wyznaczamy z samych cen: kup w
 * tańszej puli, sprzedaj w droższej. estProfitUsd = baseline netto (po koszcie gazu).
 */
export function detectOpportunities(
  rows: BlockStateRow[],
  thresholdPct = OPPORTUNITY_THRESHOLD_PCT,
): OpportunityRow[] {
  const out: OpportunityRow[] = [];
  for (const r of rows) {
    if (!(r.spreadPct > thresholdPct)) continue;
    const direction = r.direction !== "none" ? r.direction : r.priceA < r.priceB ? "a->b" : "b->a";
    out.push({
      pairId: r.pairId,
      windowId: r.windowId,
      block: r.block,
      spreadPct: r.spreadPct,
      direction,
      estProfitUsd: r.baselineNetProfitUsd,
    });
  }
  return out;
}
