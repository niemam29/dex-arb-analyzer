// Hook panelu na żywo: GET /live odświeżany co LIVE_POLL_MS_DEFAULT (tyle, co interwał pollera w
// API — częściej nie ma sensu), staleTime 5 s, żeby wejście na widok tuż po odświeżeniu nie
// strzelało drugi raz. Kształt odpowiedzi waliduje LiveSnapshotDto (apiGet -> zod).
import { useQuery } from "@tanstack/react-query";
import { LIVE_POLL_MS_DEFAULT, LiveSnapshotDto } from "@dex-arb/shared";
import { apiGet } from "./client";

export const LIVE_REFETCH_MS = LIVE_POLL_MS_DEFAULT;

export const useLive = () =>
  useQuery({
    queryKey: ["live"],
    queryFn: () => apiGet("/live", LiveSnapshotDto),
    refetchInterval: LIVE_REFETCH_MS,
    staleTime: 5_000,
  });
