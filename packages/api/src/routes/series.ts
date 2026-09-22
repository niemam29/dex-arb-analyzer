// Trasa szeregu czasowego: GET /pairs/:id/windows/:wid/series — spread/cena/gaz
// zagregowane w SQL po N bloków + avg score per model. `SeriesResponse.parse(...)` po stronie
// serwera to celowa kontrola kontraktu, jak w routes/catalog.ts i routes/coverage.ts.
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { SeriesQuery, SeriesResponse } from "@dex-arb/shared";
import { parseOr400 } from "../plugins/zod.js";
import { loadSeries } from "../queries/series.sql.js";

const Params = z.object({ id: z.coerce.number().int().positive(), wid: z.coerce.number().int().positive() });

export const seriesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/pairs/:id/windows/:wid/series", async (req) => {
    const { id, wid } = parseOr400(Params, req.params);
    const q = parseOr400(SeriesQuery, req.query);
    return SeriesResponse.parse(await loadSeries(app.db, { pairId: id, windowId: wid, ...q }));
  });
};
