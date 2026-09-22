// Lista zadań kolejki — typ/parametry/status (Badge)/postęp (Bar)/log/błąd; przycisk retry dla
// zadań `failed` (patrz `onRetry` prop w JobsList.tsx).
import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JobDto } from "@dex-arb/shared";
import { JobsList, JOB_TONE } from "./JobsList";

const jobs: JobDto[] = [
  {
    id: 7,
    type: "ingest:pool-window",
    params: { poolId: 1, windowId: 1 },
    status: "running",
    progress: 42.4,
    log: "chunk 12/30",
    error: null,
    attempts: 0,
    created_at: "2026-08-26T10:00:00.000Z",
    started_at: "2026-08-26T10:00:01.000Z",
    finished_at: null,
  },
  {
    id: 6,
    type: "analyze:pair-window",
    params: { pairId: 1, windowId: 1 },
    status: "failed",
    progress: 10,
    log: "RPC timeout",
    error: "ETIMEDOUT po 3 próbach",
    attempts: 1,
    created_at: "2026-08-26T09:00:00.000Z",
    started_at: "2026-08-26T09:00:01.000Z",
    finished_at: "2026-08-26T09:01:00.000Z",
  },
];

it("renderuje typ, parametry, status jako Badge i postęp jako Bar", () => {
  render(<JobsList jobs={jobs} />);
  expect(screen.getByText("#7")).toBeInTheDocument();
  expect(screen.getByText("ingest:pool-window")).toBeInTheDocument();
  expect(screen.getByText("poolId=1, windowId=1")).toHaveClass("mono");
  expect(screen.getByText("42%")).toBeInTheDocument();
  expect(screen.getByText("running")).toHaveClass("badge", "badge--info");
  expect(screen.getByText("failed")).toHaveClass("badge", "badge--danger");
  expect(Number(screen.getByRole("progressbar", { name: "postęp #7" }).getAttribute("aria-valuenow"))).toBeCloseTo(0.424, 6);
  expect(screen.getByText("RPC timeout")).toBeInTheDocument();
});

it("JOB_TONE mapuje statusy: queued=muted, running=info, done=ok, failed=danger", () => {
  expect(JOB_TONE).toEqual({ queued: "muted", running: "info", done: "ok", failed: "danger" });
});

it("błąd zadania (JobDto.error) jest pokazany pod logiem w klasie job-error", () => {
  render(<JobsList jobs={jobs} />);
  const err = screen.getByText("ETIMEDOUT po 3 próbach");
  expect(err).toHaveClass("job-error");
  expect(document.querySelectorAll(".job-error")).toHaveLength(1);
});

it("pusta lista → pusty stan", () => {
  render(<JobsList jobs={[]} />);
  expect(screen.getByText("Brak zadań")).toHaveClass("empty-title");
});

it("przycisk Ponów widoczny tylko dla failed i wywołuje onRetry z id", async () => {
  const onRetry = vi.fn();
  render(<JobsList jobs={jobs} onRetry={onRetry} />);
  const buttons = screen.getAllByRole("button", { name: "Ponów" });
  expect(buttons).toHaveLength(1);
  expect(buttons[0]).toHaveClass("btn--ghost");
  await userEvent.click(buttons[0]!);
  expect(onRetry).toHaveBeenCalledWith(6);
});

it("log krótszy niż 2 linie renderuje się w całości, bez <details>", () => {
  render(<JobsList jobs={jobs} />);
  expect(screen.getByText("chunk 12/30")).toBeInTheDocument();
  expect(document.querySelector("details")).toBeNull();
});

it("log dłuższy niż 2 linie pokazuje tylko ogon, pełną treść w <details>", () => {
  const longLog = Array.from({ length: 8 }, (_, i) => `linia ${i + 1}`).join("\n");
  const longJob = { ...jobs[0]!, id: 9, log: longLog };
  const { container } = render(<JobsList jobs={[longJob]} />);

  const codes = container.querySelectorAll("code");
  expect(codes).toHaveLength(2);
  expect(codes[0]!.textContent).not.toContain("linia 1\n");
  expect(codes[0]!.textContent).toContain("linia 7");
  expect(codes[0]!.textContent).toContain("linia 8");
  expect(codes[1]!.textContent).toContain("linia 1\n");
  expect(codes[1]!.textContent).toContain("linia 8");

  const details = container.querySelector("details");
  expect(details).not.toBeNull();
  expect(screen.getByText(/cały log \(8 linii\)/)).toBeInTheDocument();
});

it("kolumna 'Czas' łączy start i koniec jako 'start → koniec', jawnie w UTC", () => {
  render(<JobsList jobs={jobs} />);
  // Znaczniki czasu w UI zawsze w UTC (fmtDateUtc) — niezależnie od strefy maszyny test runnera.
  expect(screen.getByText("26.08.2026, 10:00 UTC → —")).toBeInTheDocument();
  expect(screen.getByText("26.08.2026, 09:00 UTC → 26.08.2026, 09:01 UTC")).toBeInTheDocument();
});
