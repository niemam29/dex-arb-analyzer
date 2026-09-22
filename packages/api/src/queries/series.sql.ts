// Zapytania dla GET /pairs/:id/windows/:wid/series: szereg czasowy
// zagregowany w SQL po N bloków (kubełki) — dwa zapytania: (1) agregacja block_states per
// kubełek (min/avg/max spreadu, ostatnia cena, mediana gazu, timestamp z LEFT JOIN blocks),
// (2) avg(score) per (kubełek, model); łączenie w JS (mergeSeries). Wzorowane na
// `packages/db/src/queries/coverage.ts` (`loadCoverage`).
import { sql } from "drizzle-orm";
import { SPREAD_THRESHOLD_PCT, type SeriesPointDto, type SeriesResponse } from "@dex-arb/shared";
import type { Db } from "@dex-arb/db";
import { HttpError } from "../plugins/zod.js";

export const TARGET_POINTS = 2000;
// Bezpiecznik: nawet przy jawnie podanym (małym) step nie zwracamy więcej punktów niż to —
// zapobiega odpowiedziom rzędu setek tysięcy punktów przy realnym oknie (~77 388 bloków) i
// step=1.
export const MAX_POINTS = 4000;

/** Krok domyślny: tyle bloków na kubełek, by liczba punktów nie przekroczyła `target`. */
export function autoStep(totalBlocks: number, target = TARGET_POINTS): number {
  return Math.max(1, Math.ceil(totalBlocks / target));
}

type WindowRow = { from_block: number | null; to_block: number | null };
type BucketRow = {
  bucket: string;
  ts: string | null;
  price_a: number | null;
  price_b: number | null;
  spread_avg: number | null;
  spread_min: number | null;
  spread_max: number | null;
  gas_median: number | null;
};
type ScoreRow = { bucket: string; model_id: number; score_avg: number | null };
type ModelRow = { id: number; name: string; kind: string };

export type SeriesArgs = {
  pairId: number;
  windowId: number;
  step?: number | undefined;
  from?: number | undefined;
  to?: number | undefined;
};

export async function loadSeries(db: Db, a: SeriesArgs): Promise<SeriesResponse> {
  // from_block/to_block to bigint w bazie — postgres-js zwraca int8 jako string; rzutujemy na
  // integer (numery bloków Ethereum mieszczą się w int4), jak w routes/catalog.ts (GET /windows),
  // żeby WindowRow (number | null) było prawdziwe w runtime, nie tylko na papierze w typach.
  const win = (await db.execute(
    sql`SELECT from_block::int AS from_block, to_block::int AS to_block FROM windows WHERE id = ${a.windowId}`,
  )) as unknown as WindowRow[];
  if (!win.length) throw new HttpError(404, "Brak okna");
  const pair = (await db.execute(sql`SELECT 1 FROM pairs WHERE id = ${a.pairId}`)) as unknown[];
  if (!pair.length) throw new HttpError(404, "Brak pary");
  if (win[0]!.from_block == null || win[0]!.to_block == null) {
    throw new HttpError(409, "Okno nie ma jeszcze wyznaczonych bloków");
  }

  const winFrom = win[0]!.from_block;
  const winTo = win[0]!.to_block;
  // Przycięcie jednostronne: `from` podniesione do winFrom, gdy zejdzie poniżej (żądanie
  // "od zawsze" ma sens — po prostu zaczynamy od początku okna); `to` obniżone do winTo, gdy
  // wyjdzie powyżej (analogicznie "do zawsze" kończy się na końcu okna). Celowo NIE przycinamy
  // `from` od góry do winTo ani `to` od dołu do winFrom — dzięki temu poniższy test `from > to`
  // wyłapuje żądania spoza okna (np. from=99999999 albo to=1 w oknie [1000,1999]), które w
  // ogóle nie przecinają się z oknem, zamiast po cichu zwracać zdegenerowany, mylący zakres
  // o długości jednego bloku.
  const from = Math.max(a.from ?? winFrom, winFrom);
  const to = Math.min(a.to ?? winTo, winTo);
  if (from > to) throw new HttpError(400, "Żądany zakres from/to nie przecina się z oknem");

  let step = a.step ?? autoStep(to - from + 1);
  const maxPossiblePoints = Math.ceil((to - from + 1) / step);
  if (maxPossiblePoints > MAX_POINTS) step = autoStep(to - from + 1, MAX_POINTS);

  const buckets = (await db.execute(sql`
    SELECT (bs.block - ${from}) / ${step} AS bucket,
           to_char(max(b.timestamp) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ts,
           (array_agg(bs.price_a ORDER BY bs.block DESC))[1] AS price_a,
           (array_agg(bs.price_b ORDER BY bs.block DESC))[1] AS price_b,
           avg(bs.spread_pct) AS spread_avg, min(bs.spread_pct) AS spread_min, max(bs.spread_pct) AS spread_max,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY bs.gas_price_median) AS gas_median
    FROM block_states bs
    LEFT JOIN blocks b ON b.number = bs.block
    WHERE bs.pair_id = ${a.pairId} AND bs.window_id = ${a.windowId} AND bs.block BETWEEN ${from} AND ${to}
    GROUP BY bucket
    ORDER BY bucket
  `)) as unknown as BucketRow[];

  const scores = (await db.execute(sql`
    SELECT (ms.block - ${from}) / ${step} AS bucket, ms.model_id, avg(ms.score) AS score_avg
    FROM model_scores ms
    WHERE ms.pair_id = ${a.pairId} AND ms.block BETWEEN ${from} AND ${to}
    GROUP BY bucket, ms.model_id
  `)) as unknown as ScoreRow[];

  // Tylko modele, które mają choć jeden wynik w żądanym zakresie (pair_id, [from, to]) — inaczej
  // odpowiedź niesie kolumny modeli z samymi `null` (np. inna para/okno albo model wytrenowany
  // później), które i tak nie mają czego pokazać na wykresie.
  const models = (await db.execute(sql`
    SELECT sm.id, sm.name, sm.kind FROM scoring_models sm
    WHERE EXISTS (
      SELECT 1 FROM model_scores ms
      WHERE ms.model_id = sm.id AND ms.pair_id = ${a.pairId} AND ms.block BETWEEN ${from} AND ${to}
    )
    ORDER BY sm.id
  `)) as unknown as ModelRow[];

  return {
    pair_id: a.pairId,
    window_id: a.windowId,
    step,
    from_block: from,
    to_block: to,
    threshold_pct: SPREAD_THRESHOLD_PCT,
    models,
    points: mergeSeries(buckets, scores, models, from, step, to),
  };
}

/**
 * Łączy wiersze agregacji block_states z avg(score) per model w JS. `bucket` przychodzi jako
 * bigint/string z drivera (dzielenie bs.block/ms.block, obie bigint) — dlatego klucze mapy
 * scoresByBucket i porównania to string, a granice kubełka liczymy z `Number(b.bucket)`.
 */
export function mergeSeries(
  buckets: BucketRow[],
  scores: ScoreRow[],
  models: ModelRow[],
  from: number,
  step: number,
  to: number,
): SeriesPointDto[] {
  const scoresByBucket = new Map<string, Map<number, number | null>>();
  for (const s of scores) {
    const rec = scoresByBucket.get(s.bucket) ?? new Map<number, number | null>();
    rec.set(s.model_id, s.score_avg == null ? null : Number(s.score_avg));
    scoresByBucket.set(s.bucket, rec);
  }
  const num = (v: unknown): number | null => (v == null ? null : Number(v));

  return buckets.map((b) => {
    const k = Number(b.bucket);
    const rec = scoresByBucket.get(b.bucket);
    const scoresOut: Record<string, number | null> = {};
    for (const m of models) scoresOut[String(m.id)] = rec?.get(m.id) ?? null;
    return {
      from_block: from + k * step,
      to_block: Math.min(from + (k + 1) * step - 1, to),
      ts: b.ts,
      price_a: num(b.price_a),
      price_b: num(b.price_b),
      spread_avg: num(b.spread_avg),
      spread_min: num(b.spread_min),
      spread_max: num(b.spread_max),
      gas_median: num(b.gas_median),
      scores: scoresOut,
    };
  });
}
