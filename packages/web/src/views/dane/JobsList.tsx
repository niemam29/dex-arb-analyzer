// Lista zadań kolejki — komponent prezentacyjny, `DaneView` podłącza `useJobs` (polling co 2 s —
// `JOBS_POLL_MS` w api/hooks.ts) i opcjonalnie `useRetryJob` przez `onRetry`. Kartę wokół
// tabeli daje DaneView (`<Card padded={false}>`); tu tylko `.table-scroll` + `.table`.
// `JobDto.error` jest pokazywany pod logiem (przed redesignem 2026-08-27 widać było tylko `log`).
import type { JobDto } from "@dex-arb/shared";
import { Badge, JOB_TONE } from "../../components/ui/Badge";
import { Bar } from "../../components/ui/Bar";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { fmtDateUtc } from "../../format";

// Re-eksport dla starych importów/testów (JOB_TONE teraz żyje w components/ui/Badge.tsx).
export { JOB_TONE };

const fmtParams = (p: Record<string, unknown>) =>
  Object.entries(p)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(", ");
const fmtSpan = (start: string | null, end: string | null) => `${fmtDateUtc(start)} → ${fmtDateUtc(end)}`;

// 5 linii ogona logu na wiersz rozdymały wysokość strony Dane (16 861 px przy realistycznej
// liście zadań); 2 linie + `.jobs .job-log-cell` z max-width (styles/a.css) trzymają
// wiersz w rozsądnej wysokości bez utraty informacji (pełny log nadal w <details>).
const LOG_TAIL_LINES = 2;

/** Ostatnie `LOG_TAIL_LINES` linii logu — sam log bywa długi (chunki ingestu), więc w tabeli
 * pokazujemy tylko ogon, a pełną treść w `<details>` (patrz JobLog niżej). */
function tailLines(log: string, n: number): string {
  const lines = log.split("\n");
  return lines.slice(-n).join("\n");
}

function JobLog({ log }: { log: string }) {
  const lines = log.split("\n");
  const code = (text: string) => <code className="job-log">{text}</code>;
  if (lines.length <= LOG_TAIL_LINES) return code(log);
  return (
    <>
      {code(tailLines(log, LOG_TAIL_LINES))}
      <details className="job-log-details">
        <summary>cały log ({lines.length} linii)</summary>
        {code(log)}
      </details>
    </>
  );
}

export type JobsListProps = { jobs: JobDto[]; onRetry?: (id: number) => void };

export function JobsList({ jobs, onRetry }: JobsListProps) {
  if (jobs.length === 0) return <EmptyState title="Brak zadań" hint="Zleć Pobierz / Analizuj / Weryfikuj w siatce pokrycia." />;
  return (
    <div className="table-scroll">
      <table className="table jobs" aria-label="Zadania kolejki">
        <caption>Zadania kolejki</caption>
        <thead>
          <tr>
            <th>Id</th>
            <th>Typ</th>
            <th>Parametry</th>
            <th>Status</th>
            <th>Postęp</th>
            <th>Czas</th>
            <th>Log</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} className={`job job-${j.status}`}>
              <td className="key num">{`#${j.id}`}</td>
              <td>{j.type}</td>
              <td>
                <span className="mono">{fmtParams(j.params)}</span>
              </td>
              <td>
                <Badge tone={JOB_TONE[j.status]}>{j.status}</Badge>
              </td>
              <td className="job-progress">
                <Bar value={j.progress / 100} tone={j.status === "failed" ? "danger" : j.status === "done" ? "ok" : "accent"} label={`postęp #${j.id}`} />
                <span className="num">{Math.floor(j.progress)}%</span>
              </td>
              <td className="num">{fmtSpan(j.started_at, j.finished_at)}</td>
              <td className="job-log-cell">
                <JobLog log={j.log ?? ""} />
                {j.error && <p className="job-error">{j.error}</p>}
              </td>
              <td>
                {j.status === "failed" && onRetry && (
                  <Button variant="ghost" size="sm" onClick={() => onRetry(j.id)}>
                    Ponów
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
