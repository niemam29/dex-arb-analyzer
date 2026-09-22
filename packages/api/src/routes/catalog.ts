// Trasy katalogowe: GET /pairs, /windows, /models. `*.parse(...)` po stronie
// serwera to celowa kontrola kontraktu — jeśli SQL zwróci coś niezgodnego ze schematem DTO,
// dostajemy 500 w testach, nie cichy błąd w UI.
import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { PairList, WindowList, ModelList } from "@dex-arb/shared";
import { metricsSummaryFrom } from "../anfisMetrics.js";

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  app.get("/pairs", async () => {
    const rows = await app.db.execute(sql`
      SELECT p.id, p.symbol, p.token_base, p.token_quote,
             coalesce(
               json_agg(
                 json_build_object('id', pl.id, 'dex_id', pl.dex_id, 'dex_name', d.name, 'address', pl.address)
                 ORDER BY pl.dex_id
               ) FILTER (WHERE pl.id IS NOT NULL),
               '[]'
             ) AS pools
      FROM pairs p
      LEFT JOIN pools pl ON pl.pair_id = p.id
      LEFT JOIN dexes d ON d.id = pl.dex_id
      GROUP BY p.id
      ORDER BY p.id
    `);
    return PairList.parse(rows);
  });

  app.get("/windows", async () => {
    // from_block/to_block to bigint w bazie — postgres-js zwraca int8 jako string, żeby nie
    // tracić precyzji; rzutujemy na integer (numery bloków Ethereum mieszczą się w int4).
    const rows = await app.db.execute(sql`
      SELECT id, name,
             to_char(from_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS from_ts,
             to_char(to_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS to_ts,
             from_block::int AS from_block, to_block::int AS to_block
      FROM windows
      ORDER BY from_ts
    `);
    return WindowList.parse(rows);
  });

  app.get("/models", async () => {
    // metrics jest jsonb (AnfisMetrics dla kind='anfis', null dla baseline/mamdani — patrz
    // `ensureScoringModels` w packages/analysis/src/db.ts) — nie jest częścią ModelDto, więc
    // `ModelList.parse` poniżej ją ucina; służy tylko do wyliczenia `training_metrics_summary`
    // tutaj (ADR 0008). To metryki z treningu na populacji WSZYSTKICH
    // block_states (patrz komentarz w ModelDto) — nie mylić z GET /models/:id/evaluation.
    // `params` dołączane TYLKO dla kind='baseline_v2' (kilka interpretowalnych liczb, widok
    // Modele je pokazuje); dla mamdani/anfis są duże — patrz komentarz `ModelDto.params`.
    const rows = (await app.db.execute(sql`
      SELECT id, name, kind, version, metrics,
             CASE WHEN kind = 'baseline_v2' THEN params END AS params,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
      FROM scoring_models
      ORDER BY id
    `)) as { metrics: unknown; params: unknown }[];
    const withSummary = rows.map(({ params, ...row }) => {
      const training_metrics_summary = metricsSummaryFrom(row.metrics);
      return {
        ...row,
        ...(params != null ? { params } : {}),
        ...(training_metrics_summary ? { training_metrics_summary } : {}),
      };
    });
    return ModelList.parse(withSummary);
  });
};
