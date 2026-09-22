// DTO API dla szeregu czasowego spreadu/oceny — kubełkowanie bloków dla
// wykresu na dashboardzie.
import { z } from "zod";

export const SeriesQuery = z
  .object({
    /** Bloków na kubełek; brak = auto (~2000 punktów). */
    step: z.coerce.number().int().min(1).max(100_000).optional(),
    /** Zakres bloków (brush). */
    from: z.coerce.number().int().nonnegative().optional(),
    to: z.coerce.number().int().nonnegative().optional(),
  })
  // Nieznany klucz query -> 400 (spójnie z pozostałymi schematami query API).
  .strict()
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, { message: "from > to" });
export type SeriesQuery = z.infer<typeof SeriesQuery>;

export const SeriesPointDto = z.object({
  from_block: z.number().int(),
  to_block: z.number().int(),
  /** Timestamp ostatniego znanego bloku w kubełku (ISO). */
  ts: z.string().nullable(),
  /** Ostatnia cena puli A (Uniswap) w kubełku. */
  price_a: z.number().nullable(),
  /** Ostatnia cena puli B (Sushiswap) w kubełku. */
  price_b: z.number().nullable(),
  spread_avg: z.number().nullable(),
  spread_min: z.number().nullable(),
  spread_max: z.number().nullable(),
  /** Mediana gas_price_median w kubełku (gwei). */
  gas_median: z.number().nullable(),
  /** Klucz: model_id jako string -> średni score w kubełku. */
  scores: z.record(z.string(), z.number().nullable()),
});
export type SeriesPointDto = z.infer<typeof SeriesPointDto>;

export const SeriesResponse = z.object({
  pair_id: z.number().int(),
  window_id: z.number().int(),
  step: z.number().int(),
  from_block: z.number().int(),
  to_block: z.number().int(),
  threshold_pct: z.number(),
  models: z.array(z.object({ id: z.number().int(), name: z.string(), kind: z.string() })),
  points: z.array(SeriesPointDto),
});
export type SeriesResponse = z.infer<typeof SeriesResponse>;
