// Widok "Dane" — siatka pokrycia par×okien, przyciski zlecania zadań (ingest/analyze/verify) i
// lista zadań kolejki z pollingiem co 2 s (useJobs, JOBS_POLL_MS). KPI w nagłówku liczone z
// tych samych odpowiedzi (pairs/windows/jobs) — bez dodatkowych zapytań.
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { z } from "zod";
import type { JobDto, PairDto, WindowDto } from "@dex-arb/shared";
import { usePairs, useWindows, useCoverage, useJobs, useCreateJob, useRetryJob } from "../api/hooks";
import { CoverageTable } from "./dane/CoverageTable";
import { JobsList } from "./dane/JobsList";
import { jobsForAction, type ActionKind } from "./dane/jobActions";
import { ApiError } from "../api/client";
import { Loading, ErrorMessage, errorMessage } from "../components/Status";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import type { StatProps } from "../components/ui/Stat";
import { fmtInt } from "../format";

// Ciało 409 z POST /jobs to `{ error, job }` (patrz packages/api/src/routes/jobs.ts) — zadanie
// zdublowane wskazuje istniejący job, nie jego id wprost.
const ConflictBody = z.object({ job: z.object({ id: z.number() }) });

function conflictJobId(body: unknown): number | undefined {
  const parsed = ConflictBody.safeParse(body);
  return parsed.success ? parsed.data.job.id : undefined;
}

export function daneStats(pairs: PairDto[], windows: WindowDto[], jobs: JobDto[]): StatProps[] {
  const done = jobs.filter((j) => j.status === "done").length;
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running").length;
  return [
    { label: "Pary", value: fmtInt(pairs.length) },
    { label: "Okna", value: fmtInt(windows.length) },
    { label: "Zadania done / łącznie", value: `${fmtInt(done)} / ${fmtInt(jobs.length)}`, hint: "ostatnie 50" },
    { label: "Zadania w toku", value: fmtInt(active), tone: active > 0 ? "accent" : "muted" },
  ];
}

export function DaneView() {
  const pairs = usePairs();
  const windows = useWindows();
  const coverage = useCoverage();
  const jobs = useJobs();
  const create = useCreateJob();
  const retry = useRetryJob();
  const [msg, setMsg] = useState<string | null>(null);
  const location = useLocation();
  const loading = pairs.isPending || windows.isPending || coverage.isPending;

  // Link "Kolejka zadań" w sidebarze (Layout.tsx) wskazuje /dane#zadania — bez tego efektu
  // nawigacja tylko zmieniała URL (SPA, nie pełne przeładowanie), więc przeglądarka nie
  // przewijała do sekcji #zadania samodzielnie. Zależność od `loading` — sekcja #zadania
  // renderuje się dopiero PO załadowaniu danych (bramka `if (loading) return <Loading />` niżej),
  // więc bez niej efekt uruchamiałby się za wcześnie i nie znajdowałby elementu.
  useEffect(() => {
    if (!location.hash || loading) return;
    const el = document.querySelector(location.hash);
    el?.scrollIntoView();
  }, [location.hash, loading]);

  async function onAction(kind: ActionKind, pair: PairDto, win: WindowDto) {
    setMsg(null);
    const toCreate = jobsForAction(kind, pair, win);
    const results = await Promise.allSettled(toCreate.map((j) => create.mutateAsync(j)));
    const errs = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => {
        const reason = r.reason;
        if (reason instanceof ApiError && reason.status === 409) {
          const id = conflictJobId(reason.body);
          return id != null ? `zadanie już w kolejce (#${id})` : "zadanie już w kolejce";
        }
        return errorMessage(reason);
      });
    const ok = results.length - errs.length;
    const parts = [];
    if (ok > 0) parts.push(`Zlecono ${ok} zadanie/zadania`);
    if (errs.length > 0) parts.push(errs.join("; "));
    setMsg(parts.join(" — "));
  }

  function onRetry(id: number) {
    setMsg(null);
    retry.mutate(id, {
      onError: (err) => setMsg(errorMessage(err)),
    });
  }

  if (loading) return <Loading />;
  if (pairs.error || windows.error || coverage.error)
    return <ErrorMessage error={pairs.error ?? windows.error ?? coverage.error} />;

  const jobList: JobDto[] = jobs.data ?? [];

  return (
    <>
      <PageHeader crumbs={["Dane", "Pokrycie"]} title="Dane" stats={daneStats(pairs.data, windows.data, jobList)} />
      <div className="stack">
        <CoverageTable pairs={pairs.data} windows={windows.data} coverage={coverage.data} onAction={onAction} />
        {msg && (
          <p className="status status--info" role="status">
            {msg}
          </p>
        )}
        <section id="zadania">
          <Card title="Zadania" meta={jobs.isFetching ? "odświeżanie…" : `ostatnie ${fmtInt(jobList.length)}`} padded={false}>
            <JobsList jobs={jobList} onRetry={onRetry} />
          </Card>
        </section>
      </div>
    </>
  );
}
