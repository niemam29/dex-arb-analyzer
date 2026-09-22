// Kształtowanie danych `SeriesResponse` do wierszy pod Recharts — spłaszczenie `scores` (mapa
// model_id -> score) do kolumn `m<id>`, żeby każdy model miał własny `dataKey` na wykresie
// (ScoreChart.tsx), plus etykieta bloku na oś X.
import type { SeriesResponse } from "@dex-arb/shared";

export type ChartRow = {
  block: number;
  label: string;
  ts: string | null;
  price_a: number | null;
  price_b: number | null;
  spread_avg: number | null;
  spread_min: number | null;
  spread_max: number | null;
  gas_median: number | null;
  [modelKey: `m${number}`]: number | null;
};

/** Etykieta punktu wykresu: `#<block> DD.MM.YYYY HH:MM`, jawnie w UTC (dane on-chain są w UTC;
 * strefa maszyny użytkownika nie ma tu znaczenia — patrz `fmtDateUtc` w `../../format`). Bez
 * sufiksu „UTC" (miejsce na osi X ciasne); tooltip/karta wykresu nie niosą własnej strefy. */
export function fmtBlockLabel(block: number, ts: string | null): string {
  if (!ts) return `#${block}`;
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `#${block} ${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function toChartRows(s: SeriesResponse): ChartRow[] {
  return s.points.map((p) => {
    const row = {
      block: p.from_block,
      // `ts` to `max(timestamp)` bloków w kubełku (patrz `packages/api/src/queries/series.sql.ts`)
      // — czyli czas OSTATNIEGO bloku kubełka, nie pierwszego. Etykieta bloku musi więc pokazywać
      // `to_block` razem z tym `ts`, inaczej numer bloku i godzina obok niego nie odpowiadałyby
      // sobie (np. "#1000 12:00" przy `ts` faktycznie z bloku 1004).
      label: fmtBlockLabel(p.to_block, p.ts),
      ts: p.ts,
      price_a: p.price_a,
      price_b: p.price_b,
      spread_avg: p.spread_avg,
      spread_min: p.spread_min,
      spread_max: p.spread_max,
      gas_median: p.gas_median,
    } as ChartRow;
    for (const m of s.models) row[`m${m.id}`] = p.scores[String(m.id)] ?? null;
    return row;
  });
}

// Kolory per `kind` modelu — od redesignu 2026-08-27 jedynym źródłem jest src/theme.ts
// (custom properties + fallback); re-eksport dla zgodności starych importów.
export { MODEL_COLORS } from "../../theme";
