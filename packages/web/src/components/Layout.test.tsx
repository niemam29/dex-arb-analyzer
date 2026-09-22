// packages/web/src/components/Layout.test.tsx
// Szkielet aplikacji: sidebar z sekcjami Analiza/System, aktywny link, licznik zadań
// (queued+running) z hooka jobs w AppLayout; sam Layout jest czysty (bez pobierania danych).
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { JobDto } from "@dex-arb/shared";
import { Layout, AppLayout, activeJobsCount } from "./Layout";

afterEach(() => vi.unstubAllGlobals());

const job = (id: number, status: JobDto["status"]): JobDto => ({
  id,
  type: "ingest:pool-window",
  params: { poolId: 1, windowId: 1 },
  status,
  progress: 0,
  log: "",
  error: null,
  attempts: 0,
  created_at: "2026-01-01T00:00:00Z",
  started_at: null,
  finished_at: null,
});

it("activeJobsCount liczy tylko queued i running", () => {
  expect(activeJobsCount([job(1, "queued"), job(2, "running"), job(3, "done"), job(4, "failed")])).toBe(2);
  expect(activeJobsCount([])).toBe(0);
});

it("Layout renderuje markę, sekcje nawigacji, aktywny link i licznik kolejki", () => {
  render(
    <MemoryRouter initialEntries={["/okazje"]}>
      <Routes>
        <Route element={<Layout queueCount={3} />}>
          <Route path="/okazje" element={<p>treść okazji</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByText("dex-arb-analyzer")).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Analiza" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "System" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Okazje" })).toHaveClass("active");
  expect(screen.getByRole("link", { name: "Dane" })).not.toHaveClass("active");
  const queue = screen.getByRole("link", { name: /Kolejka zadań/ });
  expect(queue).toHaveAttribute("href", "/dane#zadania");
  expect(queue.querySelector(".nav-count")).toHaveTextContent("3");
  expect(screen.getByText("treść okazji")).toBeInTheDocument();
});

it("Layout bez queueCount albo z 0 nie pokazuje licznika", () => {
  render(
    <MemoryRouter>
      <Layout queueCount={0} />
    </MemoryRouter>,
  );
  expect(document.querySelector(".nav-count")).toBeNull();
});

it("AppLayout pobiera zadania i pokazuje liczbę queued+running", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify([job(1, "queued"), job(2, "running"), job(3, "done")]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(document.querySelector(".nav-count")).toHaveTextContent("2"));
});

it("„Na żywo” jest pierwszą pozycją sekcji Analiza i prowadzi do /live", () => {
  render(
    <MemoryRouter initialEntries={["/live"]}>
      <Layout queueCount={0} />
    </MemoryRouter>,
  );
  const analiza = screen.getByRole("navigation", { name: "Analiza" });
  const links = Array.from(analiza.querySelectorAll("a")).map((a) => a.textContent);
  expect(links).toEqual(["Na żywo", "Dane", "Okno", "Okazje", "Modele"]);
  const live = screen.getByRole("link", { name: "Na żywo" });
  expect(live).toHaveAttribute("href", "/live");
  expect(live).toHaveClass("active");
});
