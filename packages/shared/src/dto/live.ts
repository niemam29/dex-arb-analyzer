// DTO panelu „Na żywo" (spec 2026-08-27-live-panel-design.md §6): GET /live zwraca ostatnią
// dobrą próbkę (`pairs`) + historię ostatniej godziny per para (`history`). Pola snake_case jak
// pozostałe DTO API. Przed pierwszą dobrą próbką at/block/eth_usd/gas_gwei są null (patrz
// `emptyLiveSnapshot`) — dlatego nullable, mimo że spec §6 pokazuje je jako liczby.
import { z } from "zod";
import { DIRECTION_KINDS } from "../constants.js";
import { ModelScoreDto } from "./opportunities.js";

/** Kolejność modeli w pigułkach i tabeli widoku. */
export const LIVE_MODEL_KEYS = ["baseline", "mamdani", "baseline_v2", "anfis"] as const;
export type LiveModelKey = (typeof LIVE_MODEL_KEYS)[number];

/** Ocena każdego z 4 modeli; `null` = brak parametrów modelu w `scoring_models` (spec §4, §10). */
export const LiveScoresDto = z.object({
  baseline: ModelScoreDto.nullable(),
  mamdani: ModelScoreDto.nullable(),
  baseline_v2: ModelScoreDto.nullable(),
  anfis: ModelScoreDto.nullable(),
});
export type LiveScoresDto = z.infer<typeof LiveScoresDto>;

export const LivePoolDto = z.object({ dex_name: z.string(), price: z.number() });
export type LivePoolDto = z.infer<typeof LivePoolDto>;

export const LiveFeaturesDto = z.object({ s: z.number(), g: z.number(), l: z.number(), m: z.number() });
export type LiveFeaturesDto = z.infer<typeof LiveFeaturesDto>;

export const LivePairDto = z.object({
  pair_id: z.number().int(),
  symbol: z.string(),
  pool_a: LivePoolDto,
  pool_b: LivePoolDto,
  spread_pct: z.number(),
  direction: z.enum(DIRECTION_KINDS),
  opt_trade_usd: z.number(),
  gross_profit_usd: z.number(),
  net_profit_usd: z.number(),
  tvl_min_usd: z.number(),
  features: LiveFeaturesDto,
  /** średnia liczba Swapów obu pul na blok w ostatnich LIVE_SWAP_LOOKBACK_BLOCKS blokach */
  swaps_per_block: z.number(),
  scores: LiveScoresDto,
});
export type LivePairDto = z.infer<typeof LivePairDto>;

export const LivePointDto = z.object({
  at: z.string(),
  block: z.number().int(),
  spread_pct: z.number(),
  net_profit_usd: z.number(),
  scores: LiveScoresDto,
});
export type LivePointDto = z.infer<typeof LivePointDto>;

export const LiveSnapshotDto = z.object({
  /** ISO czasu ostatniej DOBREJ próbki; null przed pierwszą */
  at: z.string().nullable(),
  block: z.number().int().nullable(),
  eth_usd: z.number().nullable(),
  gas_gwei: z.number().nullable(),
  /** true, gdy ostatnia próbka się nie udała (pokazujemy poprzednią) albo nie było jeszcze żadnej */
  stale: z.boolean(),
  /** false, gdy rezerwy pobrano z tagiem `latest` zamiast numeru bloku (fallback, spec §10) */
  consistent: z.boolean(),
  error: z.string().nullable(),
  /** false gdy LIVE_ENABLED=false → widok pokazuje EmptyState */
  enabled: z.boolean(),
  pairs: z.array(LivePairDto),
  /** klucz: pair_id jako string (JSON) */
  history: z.record(z.string(), z.array(LivePointDto)),
});
export type LiveSnapshotDto = z.infer<typeof LiveSnapshotDto>;

/** GET /live nie przyjmuje parametrów zapytania — nieznany klucz → 400 (spec §6). */
export const LiveQuery = z.object({}).strict();
export type LiveQuery = z.infer<typeof LiveQuery>;

/** Snapshot bez żadnej próbki (start procesu albo LIVE_ENABLED=false). */
export function emptyLiveSnapshot(enabled: boolean): LiveSnapshotDto {
  return { at: null, block: null, eth_usd: null, gas_gwei: null, stale: true, consistent: true, error: null, enabled, pairs: [], history: {} };
}

/**
 * Minimalny kontrakt magazynu próbek, jaki widzi trasa `GET /live` (`@dex-arb/api`). Implementacja
 * (`LiveStore` w `@dex-arb/analysis`) jest wstrzykiwana w `server.ts`; testy API podają atrapę.
 */
export interface LiveStoreLike {
  snapshot(): LiveSnapshotDto;
}

/** Wynik jednej próbki pollera — wspólny dla `createLiveRuntime` (analysis) i `startLivePoller` (api). */
export type LiveTickResult = { ok: true; block: number } | { ok: false; error: string };
