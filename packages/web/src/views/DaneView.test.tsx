// Widok Dane end-to-end z zamockowanym fetch — renderowanie komórek pokrycia, zlecanie zadań
// ingestu (Pobierz → jedno `ingest:pool-window` per pula, camelCase params), komunikat przy 409
// (`{ error, job }` → "zadanie już w kolejce (#id)") i ponowienie zadania `failed` przyciskiem
// "Ponów" (POST /jobs/:id/retry). Logika przycisków/tabeli ma własne testy w
// dane/CoverageTable.test.tsx i dane/jobActions.test.ts — tu sprawdzamy przewodowanie całego
// widoku przez prawdziwy fetch.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { DaneView } from "./DaneView";

const pairsBody = [
  {
    id: 1,
    symbol: "WETH/USDC",
    token_base: "0x1",
    token_quote: "0x2",
    pools: [
      { id: 1, dex_id: 1, dex_name: "Uniswap V2", address: "0xa" },
      { id: 2, dex_id: 2, dex_name: "Sushiswap", address: "0xb" },
    ],
  },
];
const windowsBody = [
  { id: 1, name: "maj 2021", from_ts: "2021-05-14T00:00:00Z", to_ts: "2021-05-26T00:00:00Z", from_block: 1, to_block: 1000 },
];
const coverageBody = [
  {
    pair_id: 1,
    window_id: 1,
    window_has_blocks: true,
    block_states: 0,
    states_min_block: null,
    states_max_block: null,
    scored_models: 0,
    pools: [
      { pool_id: 1, dex_name: "Uniswap V2", done_blocks: 0, failed_blocks: 0, pending_blocks: 1000, total_blocks: 1000, coverage_pct: 0 },
      { pool_id: 2, dex_name: "Sushiswap", done_blocks: 0, failed_blocks: 0, pending_blocks: 1000, total_blocks: 1000, coverage_pct: 0 },
    ],
  },
];
const coverageWithStatesBody = [{ ...coverageBody[0]!, block_states: 10 }];

const failedJob = {
  id: 7,
  type: "ingest:pool-window",
  params: { poolId: 1, windowId: 1 },
  status: "failed",
  progress: 0,
  log: "błąd RPC",
  error: "timeout",
  attempts: 3,
  created_at: "2026-01-01T00:00:00Z",
  started_at: "2026-01-01T00:00:01Z",
  finished_at: "2026-01-01T00:00:02Z",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderDaneView(initialEntries: string[] = ["/dane"]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <DaneView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("renderuje komórki pokrycia po załadowaniu danych", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/pairs")) return Promise.resolve(jsonResponse(pairsBody));
      if (url.includes("/api/windows")) return Promise.resolve(jsonResponse(windowsBody));
      if (url.includes("/api/coverage")) return Promise.resolve(jsonResponse(coverageBody));
      if (url.includes("/api/jobs")) return Promise.resolve(jsonResponse([]));
      return Promise.reject(new Error(`nieoczekiwany fetch: ${url}`));
    }),
  );

  renderDaneView();

  await waitFor(() => expect(screen.getByText("WETH/USDC")).toBeInTheDocument());
  expect(screen.getByRole("heading", { name: "Dane" })).toBeInTheDocument();
  expect(screen.getByText("Uniswap V2")).toBeInTheDocument();
  expect(screen.getByText("Sushiswap")).toBeInTheDocument();
  expect(screen.getAllByText("0%")).toHaveLength(2);
  expect(screen.getByText("Brak zadań")).toBeInTheDocument();
  // KPI z PageHeader: 1 para, 1 okno, 0/0 zadań done, 0 w toku
  expect(screen.getByText("Pary").nextElementSibling).toHaveTextContent("1");
  expect(screen.getByText("Zadania w toku").nextElementSibling).toHaveTextContent("0");
});

it("Pobierz zleca jedno zadanie ingest:pool-window per pula pary (camelCase params)", async () => {
  const posted: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/api/jobs")) {
        const body = JSON.parse(String(init.body));
        posted.push(body);
        return Promise.resolve(jsonResponse({ ...body, id: posted.length, status: "queued", progress: 0, log: "", error: null, attempts: 0, created_at: "2026-01-01T00:00:00Z", started_at: null, finished_at: null }));
      }
      if (url.includes("/api/pairs")) return Promise.resolve(jsonResponse(pairsBody));
      if (url.includes("/api/windows")) return Promise.resolve(jsonResponse(windowsBody));
      if (url.includes("/api/coverage")) return Promise.resolve(jsonResponse(coverageBody));
      if (url.includes("/api/jobs")) return Promise.resolve(jsonResponse([]));
      return Promise.reject(new Error(`nieoczekiwany fetch: ${url}`));
    }),
  );

  renderDaneView();
  await waitFor(() => expect(screen.getByText("WETH/USDC")).toBeInTheDocument());

  await userEvent.click(screen.getByRole("button", { name: "Pobierz" }));

  await waitFor(() => expect(posted).toHaveLength(2));
  expect(posted).toEqual([
    { type: "ingest:pool-window", params: { poolId: 1, windowId: 1 } },
    { type: "ingest:pool-window", params: { poolId: 2, windowId: 1 } },
  ]);
});

it("409 z POST /jobs pokazuje komunikat z id istniejącego zadania", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/api/jobs")) {
        return Promise.resolve(
          jsonResponse({ error: "zadanie już czeka lub trwa", job: { id: 42, status: "queued" } }, 409),
        );
      }
      if (url.includes("/api/pairs")) return Promise.resolve(jsonResponse(pairsBody));
      if (url.includes("/api/windows")) return Promise.resolve(jsonResponse(windowsBody));
      if (url.includes("/api/coverage")) return Promise.resolve(jsonResponse(coverageBody));
      if (url.includes("/api/jobs")) return Promise.resolve(jsonResponse([]));
      return Promise.reject(new Error(`nieoczekiwany fetch: ${url}`));
    }),
  );

  renderDaneView();
  await waitFor(() => expect(screen.getByText("WETH/USDC")).toBeInTheDocument());

  await userEvent.click(screen.getByRole("button", { name: "Pobierz" }));

  await waitFor(() => expect(screen.getByText(/zadanie już w kolejce \(#42\)/)).toBeInTheDocument());
});

it("zadanie failed pokazuje Ponów, klik POSTuje /jobs/:id/retry", async () => {
  let retried = false;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/api/jobs/7/retry")) {
        retried = true;
        return Promise.resolve(jsonResponse({ ...failedJob, status: "queued", attempts: 3, error: null }));
      }
      if (url.includes("/api/pairs")) return Promise.resolve(jsonResponse(pairsBody));
      if (url.includes("/api/windows")) return Promise.resolve(jsonResponse(windowsBody));
      if (url.includes("/api/coverage")) return Promise.resolve(jsonResponse(coverageBody));
      if (url.includes("/api/jobs")) return Promise.resolve(jsonResponse([failedJob]));
      return Promise.reject(new Error(`nieoczekiwany fetch: ${url}`));
    }),
  );

  renderDaneView();
  await waitFor(() => expect(screen.getByRole("button", { name: "Ponów" })).toBeInTheDocument());

  await userEvent.click(screen.getByRole("button", { name: "Ponów" }));

  await waitFor(() => expect(retried).toBe(true));
});

it("Weryfikuj (aktywny gdy block_states > 0) zleca verify:pair-window i odświeża pokrycie", async () => {
  const posted: unknown[] = [];
  let coverageCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/api/jobs")) {
        const body = JSON.parse(String(init.body));
        posted.push(body);
        return Promise.resolve(jsonResponse({ ...body, id: posted.length, status: "queued", progress: 0, log: "", error: null, attempts: 0, created_at: "2026-01-01T00:00:00Z", started_at: null, finished_at: null }));
      }
      if (url.includes("/api/pairs")) return Promise.resolve(jsonResponse(pairsBody));
      if (url.includes("/api/windows")) return Promise.resolve(jsonResponse(windowsBody));
      if (url.includes("/api/coverage")) {
        coverageCalls++;
        return Promise.resolve(jsonResponse(coverageWithStatesBody));
      }
      if (url.includes("/api/jobs")) return Promise.resolve(jsonResponse([]));
      return Promise.reject(new Error(`nieoczekiwany fetch: ${url}`));
    }),
  );

  renderDaneView();
  await waitFor(() => expect(screen.getByText("WETH/USDC")).toBeInTheDocument());
  const verifyButton = screen.getByRole("button", { name: "Weryfikuj" });
  expect(verifyButton).toBeEnabled();
  const coverageCallsBeforeClick = coverageCalls;

  await userEvent.click(verifyButton);

  await waitFor(() => expect(posted).toHaveLength(1));
  // `force: true` zawsze — patrz jobActions.ts/jobActions.test.ts.
  expect(posted).toEqual([{ type: "verify:pair-window", params: { pairId: 1, windowId: 1, force: true } }]);
  await waitFor(() => expect(coverageCalls).toBeGreaterThan(coverageCallsBeforeClick));
});

it("błąd sieci (nie ApiError) przy ładowaniu pokazuje String(err), nie [object Object]", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("sieć padła"))),
  );

  renderDaneView();

  await waitFor(() => expect(screen.getByText(/Błąd: Error: sieć padła/)).toBeInTheDocument());
});

it("wejście z #zadania w URL (link 'Kolejka zadań' w Layout) przewija do sekcji zadań", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/pairs")) return Promise.resolve(jsonResponse(pairsBody));
      if (url.includes("/api/windows")) return Promise.resolve(jsonResponse(windowsBody));
      if (url.includes("/api/coverage")) return Promise.resolve(jsonResponse(coverageBody));
      if (url.includes("/api/jobs")) return Promise.resolve(jsonResponse([]));
      return Promise.reject(new Error(`nieoczekiwany fetch: ${url}`));
    }),
  );
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;

  renderDaneView(["/dane#zadania"]);

  await waitFor(() => expect(screen.getByText("WETH/USDC")).toBeInTheDocument());
  await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
});
