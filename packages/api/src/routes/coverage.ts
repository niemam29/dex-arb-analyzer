// Trasa pokrycia: GET /coverage — macierz para×okno z pokryciem ingestu
// (per pula) i analizy (block_states, model_scores). `CoverageResponse.parse(...)` po stronie
// serwera to celowa kontrola kontraktu, jak w routes/catalog.ts.
import type { FastifyPluginAsync } from "fastify";
import { CoverageResponse } from "@dex-arb/shared";
import { loadCoverage } from "@dex-arb/db";

export const coverageRoutes: FastifyPluginAsync = async (app) => {
  app.get("/coverage", async () => CoverageResponse.parse(await loadCoverage(app.db)));
};
