// Hooki API dla widoku "Modele" — ewaluacja modelu (GET
// /models/:id/evaluation), trening ANFIS (POST /models/anfis/train) i polling pojedynczego
// zadania (GET /jobs/:id). Kształty i nazwy pól snake_case dokładnie wg
// packages/shared/src/dto/{models,evaluation}.ts. `useModels`/`useWindows`
// są już w ./hooks.ts — nie duplikujemy ich tutaj.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EvaluationDto, JobDto, type CalibrateBaselineV2Request, type TrainRequest } from "@dex-arb/shared";
import { apiGet, apiPost } from "./client";

export const JOB_POLL_MS = 2_000;

export function useEvaluation(modelId: number | null, windowId: number | null) {
  return useQuery({
    queryKey: ["evaluation", modelId, windowId],
    queryFn: () =>
      apiGet(`/models/${modelId}/evaluation${windowId != null ? `?window=${windowId}` : ""}`, EvaluationDto),
    enabled: modelId != null,
  });
}

/**
 * POST /models/anfis/train — zwraca `JobDto` (201, reużywa istniejący kontrakt zadań, jak
 * POST /jobs w ./hooks.ts). Odświeża listę zadań; listę modeli odświeża wywołujący dopiero po
 * `status === 'done'` (patrz ModeleView) — nowy model istnieje w bazie dopiero wtedy.
 */
export function useTrainAnfis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TrainRequest) => apiPost("/models/anfis/train", body, JobDto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

/** POST /models/baseline_v2/calibrate — jak `useTrainAnfis`, dla baseline'u skalibrowanego. */
export function useCalibrateBaselineV2() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CalibrateBaselineV2Request) => apiPost("/models/baseline_v2/calibrate", body, JobDto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

/** Polling GET /jobs/:id co JOB_POLL_MS, zatrzymuje się po statusie 'done'/'failed'. */
export function useJob(id: number | null) {
  return useQuery({
    queryKey: ["jobs", id],
    queryFn: () => apiGet(`/jobs/${id}`, JobDto),
    enabled: id != null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "done" || status === "failed" ? false : JOB_POLL_MS;
    },
  });
}
