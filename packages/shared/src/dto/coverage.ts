// DTO API dla macierzy pokrycia par×okien — agreguje `ingest_ranges` (per
// pula), `block_states` i `model_scores` (per para/okno) na potrzeby dashboardu.
import { z } from "zod";

export const PoolCoverageDto = z.object({
  pool_id: z.number().int(),
  dex_name: z.string(),
  done_blocks: z.number().int(),
  failed_blocks: z.number().int(),
  pending_blocks: z.number().int(),
  /** to_block - from_block + 1 (0, gdy okno bez wyznaczonych bloków). */
  total_blocks: z.number().int(),
  /**
   * 0–100, `null` gdy okno nie ma wyznaczonych bloków (`windows.from_block`/`to_block` NULL) —
   * patrz `CoverageCellDto.window_has_blocks` ("coverage null/0 z flagą").
   */
  coverage_pct: z.number().nullable(),
});
export type PoolCoverageDto = z.infer<typeof PoolCoverageDto>;

export const CoverageCellDto = z.object({
  pair_id: z.number().int(),
  window_id: z.number().int(),
  /** false, gdy `windows.from_block`/`to_block` są NULL — wtedy pokrycie jest niepoliczalne. */
  window_has_blocks: z.boolean(),
  pools: z.array(PoolCoverageDto),
  /** liczba wierszy block_states dla tej pary/okna. */
  block_states: z.number().int(),
  /** min(block) z block_states dla tej pary/okna, `null` gdy brak wierszy. */
  states_min_block: z.number().int().nullable(),
  /** max(block) z block_states dla tej pary/okna, `null` gdy brak wierszy. */
  states_max_block: z.number().int().nullable(),
  /** liczba modeli z jakimkolwiek wynikiem w model_scores dla tej pary/okna. */
  scored_models: z.number().int(),
});
export type CoverageCellDto = z.infer<typeof CoverageCellDto>;

export const CoverageResponse = z.array(CoverageCellDto);
export type CoverageResponse = z.infer<typeof CoverageResponse>;
