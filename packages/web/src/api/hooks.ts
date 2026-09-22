import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PairList,
  WindowList,
  ModelList,
  CoverageResponse,
  JobList,
  JobDto,
  type JobCreate,
  SeriesResponse,
} from "@dex-arb/shared";
import { apiGet, apiPost } from "./client";

export const usePairs = () => useQuery({ queryKey: ["pairs"], queryFn: () => apiGet("/pairs", PairList), staleTime: 60_000 });
export const useWindows = () =>
  useQuery({ queryKey: ["windows"], queryFn: () => apiGet("/windows", WindowList), staleTime: 60_000 });
export const useModels = () =>
  useQuery({ queryKey: ["models"], queryFn: () => apiGet("/models", ModelList), staleTime: 60_000 });

export const useCoverage = () =>
  useQuery({
    queryKey: ["coverage"],
    queryFn: () => apiGet("/coverage", CoverageResponse),
    refetchInterval: 5_000,
  });

export const JOBS_POLL_MS = 2_000;
export const useJobs = () =>
  useQuery({
    queryKey: ["jobs"],
    queryFn: () => apiGet("/jobs?limit=50", JobList),
    refetchInterval: JOBS_POLL_MS,
  });

// Zlecenie zadania zmienia pokrycie (ingest/analyze) prędzej czy później, a `verify:pair-window`
// od razu zapisuje `opportunity_verifications` na już istniejących okazjach — obie listy więc
// unieważniamy, plus `["opportunities"]` konkretnie po zleceniu weryfikacji (widok Okazje).
export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (job: JobCreate) => apiPost("/jobs", job, JobDto),
    onSettled: (_data, _err, variables) => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["coverage"] });
      if (variables.type === "verify:pair-window") {
        void qc.invalidateQueries({ queryKey: ["opportunities"] });
      }
    },
  });
}

// Ponowienie zadania `failed` z listy zadań (`JobsList`) — POST /jobs/:id/retry (tylko ze
// statusu failed, inaczej 409). Ta sama unieważnienia jak w `useCreateJob`: `data.type` z
// odpowiedzi mówi, czy ponawiane zadanie to `verify:pair-window`.
export function useRetryJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost(`/jobs/${id}/retry`, {}, JobDto),
    onSettled: (data) => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["coverage"] });
      if (data?.type === "verify:pair-window") {
        void qc.invalidateQueries({ queryKey: ["opportunities"] });
      }
    },
  });
}

export type SeriesRange = { step?: number; from?: number; to?: number };
export function useSeries(pairId: number | undefined, windowId: number | undefined, range: SeriesRange) {
  const qs = new URLSearchParams();
  if (range.step) qs.set("step", String(range.step));
  if (range.from != null) qs.set("from", String(range.from));
  if (range.to != null) qs.set("to", String(range.to));
  const q = qs.toString();
  return useQuery({
    queryKey: ["series", pairId, windowId, range],
    queryFn: () => apiGet(`/pairs/${pairId}/windows/${windowId}/series${q ? "?" + q : ""}`, SeriesResponse),
    enabled: pairId != null && windowId != null,
    placeholderData: (prev) => prev,
  });
}
