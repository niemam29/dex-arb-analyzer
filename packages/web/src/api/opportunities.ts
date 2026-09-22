// Hooki API dla okazji arbitrażowych: lista z filtrami/paginacją (GET
// /pairs/:id/windows/:wid/opportunities) i szczegóły pojedynczej okazji (GET /opportunities/:id)
// — kształty i nazwy pól snake_case dokładnie wg packages/shared/src/dto/opportunities.ts.
import { useQuery } from "@tanstack/react-query";
import { OpportunityList, OpportunityDetail, type OpportunityListQuery } from "@dex-arb/shared";
import { apiGet } from "./client";

export type OpportunityFilters = Partial<
  Pick<OpportunityListQuery, "status" | "min_spread" | "model" | "page" | "page_size">
>;

/**
 * Ścieżka GET /pairs/:id/windows/:wid/opportunities z query zbudowanym z filtrów — pomija
 * klucze puste/undefined, żeby nie wysyłać np. `min_spread=` albo `model=`.
 */
export function opportunitiesUrl(pairId: number, windowId: number, q: OpportunityFilters): string {
  const params = new URLSearchParams();
  if (q.status) params.set("status", q.status);
  if (q.min_spread != null) params.set("min_spread", String(q.min_spread));
  if (q.model) params.set("model", q.model);
  if (q.page != null) params.set("page", String(q.page));
  if (q.page_size != null) params.set("page_size", String(q.page_size));
  const qs = params.toString();
  return `/pairs/${pairId}/windows/${windowId}/opportunities${qs ? `?${qs}` : ""}`;
}

export function useOpportunities(pairId: number | null, windowId: number | null, q: OpportunityFilters) {
  return useQuery({
    queryKey: ["opportunities", pairId, windowId, q],
    queryFn: () => apiGet(opportunitiesUrl(pairId!, windowId!, q), OpportunityList),
    enabled: pairId != null && windowId != null,
    placeholderData: (prev) => prev,
  });
}

export function useOpportunity(id: number | null) {
  return useQuery({
    queryKey: ["opportunity", id],
    queryFn: () => apiGet(`/opportunities/${id}`, OpportunityDetail),
    enabled: id != null,
  });
}
