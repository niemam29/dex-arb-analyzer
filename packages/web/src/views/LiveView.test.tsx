// Widok Na żywo z zamockowanym GET /api/live: KPI, 4 karty, pigułki, banner stale, disabled,
// tabela ostatnich próbek; pure helpers liveStats/sampleAge/recentRows.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { LiveSnapshotDto } from "@dex-arb/shared";
import { LiveView, liveStats, recentRows, sampleAge } from "./LiveView";

const scores = { baseline: { score: 19.96, label: "wykonalna" }, mamdani: { score: 40, label: "ryzykowna" }, baseline_v2: null, anfis: { score: 91.4, label: "atrakcyjna" } };
const pairOf = (id: number, symbol: string, spread: number): LiveSnapshotDto["pairs"][number] => ({
  pair_id: id, symbol,
  pool_a: { dex_name: "uniswap-v2", price: 2296.3 }, pool_b: { dex_name: "sushiswap", price: 2319.57 },
  spread_pct: spread, direction: spread >= 0.65 ? "a_to_b" : "none", opt_trade_usd: 141015.29, gross_profit_usd: 287.54, net_profit_usd: 281.48,
  tvl_min_usd: 225856851.8, features: { s: spread, g: 0.0121, l: 100, m: 50 }, swaps_per_block: 0.15, scores,
});
const at = "2026-08-27T10:00:00.000Z";
const body: LiveSnapshotDto = {
  at, block: 23000000, eth_usd: 2296.3, gas_gwei: 12.4, stale: false, consistent: true, error: null, enabled: true,
  pairs: [pairOf(1, "WETH/USDC", 1.0134), pairOf(2, "WETH/USDT", 0.7), pairOf(3, "WETH/DAI", 0.1), pairOf(4, "WBTC/WETH", 0.2)],
  history: {
    "1": [{ at: "2026-08-27T09:59:45.000Z", block: 22999999, spread_pct: 0.5, net_profit_usd: 0, scores }, { at, block: 23000000, spread_pct: 1.0134, net_profit_usd: 281.48, scores }],
    "2": [{ at: "2026-08-27T09:59:45.000Z", block: 22999999, spread_pct: 0.6, net_profit_usd: 0, scores }, { at, block: 23000000, spread_pct: 0.7, net_profit_usd: 10, scores }],
    "3": [{ at, block: 23000000, spread_pct: 0.1, net_profit_usd: 0, scores }],
    "4": [{ at, block: 23000000, spread_pct: 0.2, net_profit_usd: 0, scores }],
  },
};

function mockLive(snapshot: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/live")) return Promise.resolve(new Response(JSON.stringify(snapshot), { status: 200, headers: { "Content-Type": "application/json" } }));
      return Promise.reject(new Error(`nieoczekiwany fetch: ${url}`));
    }),
  );
}

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/live"]}>
        <LiveView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-08-27T10:00:12.000Z") }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("KPI, kontekst z wiekiem próbki, 4 karty i tabela ostatnich próbek", async () => {
  mockLive(body);
  renderView();
  expect(screen.getByRole("heading", { level: 2, name: "Na żywo" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText("Blok").nextElementSibling).toHaveTextContent("23000000"));
  expect(screen.getByText("ETH/USD").nextElementSibling).toHaveTextContent("2296,3 $");
  expect(screen.getByText("Gaz").nextElementSibling).toHaveTextContent("12,4 gwei");
  expect(screen.getByText("Pary ≥ progu").nextElementSibling).toHaveTextContent("2");
  expect(screen.getByText("z 4")).toBeInTheDocument();
  expect(screen.getByText(/Ethereum mainnet · eRPC · próbka co 15 s · 12 s temu/)).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Okruszki" }).textContent).toBe("Na żywo");
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["WETH/USDC", "WETH/USDT", "WETH/DAI", "WBTC/WETH", "Ostatnie próbki"]);
  expect(screen.getAllByText("ANFIS 91,4 · atrakcyjna")).toHaveLength(4);
  expect(screen.queryByRole("alert")).toBeNull();
  const table = screen.getByRole("table", { name: "Ostatnie próbki" });
  expect(table.closest(".table-scroll")).not.toBeNull();
  const rows = table.querySelectorAll("tbody tr");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("23000000");
  expect(rows[0]).toHaveTextContent("1,013 %");
  expect(rows[1]).toHaveTextContent("22999999");
});

it("wiek próbki tyka co sekundę niezależnie od reszty widoku (SampleAge ma własny zegar)", async () => {
  mockLive(body);
  renderView();
  await waitFor(() => expect(screen.getByText(/12 s temu/)).toBeInTheDocument());
  // Karty i reszta ciała widoku nie zależą od zegara SampleAge — nie mają powodu się przerenderować,
  // ale niezależnie od tego SampleAge sam musi tykać między refetchami GET /live (co 15 s).
  const cardHeading = screen.getByRole("heading", { level: 3, name: "WETH/USDC" });
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  expect(screen.getByText(/17 s temu/)).toBeInTheDocument();
  // Ta sama karta (nie odmontowana/zamontowana na nowo) — LiveBody nie przerenderował się przez tykanie zegara.
  expect(screen.getByRole("heading", { level: 3, name: "WETH/USDC" })).toBe(cardHeading);
});

it("stale: banner .status--error z komunikatem, karty z ostatniej dobrej próbki zostają", async () => {
  mockLive({ ...body, stale: true, error: "HTTP 429" });
  renderView();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveClass("status--error"));
  expect(screen.getByRole("alert")).toHaveTextContent("Brak świeżej próbki: HTTP 429");
  expect(screen.getByRole("heading", { level: 3, name: "WETH/USDC" })).toBeInTheDocument();
});

it("consistent=false: dopisek o tagu latest w kontekście", async () => {
  mockLive({ ...body, consistent: false });
  renderView();
  await waitFor(() => expect(screen.getByText(/rezerwy z tagiem latest/)).toBeInTheDocument());
});

it("enabled=false: EmptyState „Tryb na żywo wyłączony (LIVE_ENABLED)”", async () => {
  mockLive({ at: null, block: null, eth_usd: null, gas_gwei: null, stale: true, consistent: true, error: null, enabled: false, pairs: [], history: {} });
  renderView();
  await waitFor(() => expect(screen.getByText("Tryb na żywo wyłączony (LIVE_ENABLED)")).toBeInTheDocument());
  expect(screen.queryByRole("alert")).toBeNull();
});

it("enabled=true bez próbki: „Czekam na pierwszą próbkę…”", async () => {
  mockLive({ at: null, block: null, eth_usd: null, gas_gwei: null, stale: true, consistent: true, error: null, enabled: true, pairs: [], history: {} });
  renderView();
  await waitFor(() => expect(screen.getByText("Czekam na pierwszą próbkę…")).toBeInTheDocument());
});

it("liveStats: blok, ETH/USD, gaz, pary ≥ progu z hintem „z N”; bez próbki myślniki", () => {
  const s = liveStats(body);
  expect(s.map((x) => x.label)).toEqual(["Blok", "ETH/USD", "Gaz", "Pary ≥ progu"]);
  expect(s[0]!.value).toBe("23000000");
  expect(s[1]!.value).toBe("2296,3 $");
  expect(s[2]!.value).toBe("12,4 gwei");
  expect(s[3]).toMatchObject({ value: "2", hint: "z 4", tone: "accent" });
  const e = liveStats({ ...body, at: null, block: null, eth_usd: null, gas_gwei: null, pairs: [] });
  expect(e.map((x) => x.value)).toEqual(["—", "—", "—", "0"]);
  expect(e[3]).toMatchObject({ hint: "z 0", tone: "muted" });
});

it("sampleAge: sekundy poniżej minuty, potem minuty", () => {
  const now = new Date("2026-08-27T10:00:12.000Z");
  expect(sampleAge(at, now)).toBe("12 s temu");
  expect(sampleAge("2026-08-27T09:57:00.000Z", now)).toBe("3 min temu");
  expect(sampleAge("2026-08-27T10:00:13.000Z", now)).toBe("0 s temu");
});

it("recentRows: wiersze od najnowszej próbki, komórki per para (null gdy para nie ma punktu), limit", () => {
  const rows = recentRows(body, 20);
  expect(rows.map((r) => r.block)).toEqual([23000000, 22999999]);
  expect(rows[0]!.cells.map((c) => c.symbol)).toEqual(["WETH/USDC", "WETH/USDT", "WETH/DAI", "WBTC/WETH"]);
  expect(rows[1]!.cells[2]!.point).toBeNull();
  expect(rows[1]!.cells[0]!.point!.spread_pct).toBe(0.5);
  expect(recentRows(body, 1)).toHaveLength(1);
});
