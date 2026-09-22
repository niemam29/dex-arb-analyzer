// Trasy okazji arbitrażowych: GET /pairs/:id/windows/:wid/opportunities
// (lista, paginacja, filtry status/min_spread/model) i GET /opportunities/:id (szczegóły z
// cechami block_states, rezerwami obu pul, aktywacjami reguł Mamdaniego, weryfikacją i linkiem
// do Etherscan). `OpportunityList.parse`/`OpportunityDetail.parse` po stronie serwera to
// celowa kontrola kontraktu, jak w innych trasach (patrz routes/series.ts, routes/coverage.ts).
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { OpportunityDetail, OpportunityList, OpportunityListQuery } from "@dex-arb/shared";
import { HttpError, parseOr400 } from "../plugins/zod.js";
import { loadOpportunityDetail, loadOpportunityList } from "../queries/opportunities.sql.js";

const PairWindowParams = z.object({
  id: z.coerce.number().int().positive(),
  wid: z.coerce.number().int().positive(),
});
const IdParam = z.object({ id: z.coerce.number().int().positive() });

export const opportunitiesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/pairs/:id/windows/:wid/opportunities", async (req) => {
    const { id: pairId, wid: windowId } = parseOr400(PairWindowParams, req.params);
    const q = parseOr400(OpportunityListQuery, req.query);
    const result = await loadOpportunityList(app.db, {
      pairId,
      windowId,
      status: q.status,
      minSpread: q.min_spread,
      model: q.model,
      page: q.page,
      pageSize: q.page_size,
    });
    return OpportunityList.parse(result);
  });

  app.get("/opportunities/:id", async (req) => {
    const { id } = parseOr400(IdParam, req.params);
    const detail = await loadOpportunityDetail(app.db, id);
    if (!detail) throw new HttpError(404, `Okazja o id=${id} nie istnieje`);
    return OpportunityDetail.parse(detail);
  });
};
