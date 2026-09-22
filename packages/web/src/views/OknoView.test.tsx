// Dymny test widoku Okno — Recharts nie renderuje się sensownie w jsdom (brak layoutu w
// ResponsiveContainer), więc sprawdzamy tylko szkielet strony: nagłówki sekcji i selektory
// pary/okna po załadowaniu danych z zamockowanego fetch (logika kształtowania danych ma własne
// testy w okno/chartUtils.test.ts i okno/useBrushRange.test.ts).
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { OknoView, oknoStats } from "./OknoView";

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
  { id: 1, name: "maj 2021", from_ts: "2021-05-14T00:00:00Z", to_ts: "2021-05-26T00:00:00Z", from_block: 1000, to_block: 1999 },
];
const seriesBody = {
  pair_id: 1,
  window_id: 1,
  step: 5,
  from_block: 1000,
  to_block: 1009,
  threshold_pct: 0.65,
  models: [{ id: 1, name: "baseline", kind: "baseline" }],
  points: [
    {
      from_block: 1000,
      to_block: 1004,
      ts: "2021-05-14T00:10:00.000Z",
      price_a: 4000,
      price_b: 4004,
      spread_avg: 0.3,
      spread_min: 0.1,
      spread_max: 0.5,
      gas_median: 120,
      scores: { "1": 20 },
    },
  ],
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/pairs/1/windows/1/series")) return Promise.resolve(jsonResponse(seriesBody));
      if (url.includes("/api/pairs")) return Promise.resolve(jsonResponse(pairsBody));
      if (url.includes("/api/windows")) return Promise.resolve(jsonResponse(windowsBody));
      return Promise.reject(new Error(`nieoczekiwany fetch: ${url}`));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("renderuje PageHeader z KPI i karty wykresów po załadowaniu serii dla pary×okna", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/okno/1/1"]}>
        <Routes>
          <Route path="/okno/:pairId/:windowId" element={<OknoView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(screen.getByRole("heading", { level: 2, name: "Okno" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("heading", { name: "Cena WETH/USDC" })).toBeInTheDocument());
  expect(screen.getByRole("heading", { name: "Spread [%]" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Gaz" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Score modeli" })).toBeInTheDocument();
  expect(screen.getByText(/bloki 1000–1009/)).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Okruszki" }).textContent).toBe("Okno / WETH/USDC / maj 2021");
  // KPI z serii (from 1000, to 1009 -> 10 bloków): 1 kubełek z ceną obu pul (100%), 0 kubełków
  // ≥ progu, mediana spreadu 0,300 %
  expect(screen.getByText("Bloki w oknie").nextElementSibling).toHaveTextContent("10");
  expect(screen.getByText("Pokrycie stanów").nextElementSibling).toHaveTextContent("100 %");
  expect(screen.getByText("Kubełki ≥ progu").nextElementSibling).toHaveTextContent("0");
  expect(screen.getByText("Mediana spreadu").nextElementSibling).toHaveTextContent("0,300 %");
  expect(screen.getByRole("link", { name: "Okazje" })).toHaveAttribute("href", "/okazje/1/1");
});

it("oknoStats: bloki z from/to serii, pokrycie = kubełki z ceną obu pul, okazje ≈ kubełki ze spread_max ≥ próg, mediana spread_avg", () => {
  const stats = oknoStats({
    ...seriesBody,
    from_block: 1000,
    to_block: 1019,
    points: [
      seriesBody.points[0]!,
      { ...seriesBody.points[0]!, from_block: 1005, to_block: 1009, price_b: null, spread_avg: 0.9, spread_max: 1.2 },
      { ...seriesBody.points[0]!, from_block: 1010, to_block: 1014, spread_avg: 0.5, spread_max: 0.7 },
    ],
  });
  expect(stats.map((s) => s.label)).toEqual(["Bloki w oknie", "Pokrycie stanów", "Kubełki ≥ progu", "Mediana spreadu"]);
  expect(stats[0]!.value).toBe("20");
  expect(stats[1]!.value).toBe("67 %");
  expect(stats[1]!.hint).toBe("kubełki z ceną obu pul");
  expect(stats[2]!.value).toBe("2");
  expect(stats[2]!.hint).toBe("z serii, nie z tabeli okazji");
  expect(stats[3]!.value).toBe("0,500 %");
});

it("bez pary/okna w URL pokazuje podpowiedź zamiast wykresów", () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/okno"]}>
        <Routes>
          <Route path="/okno" element={<OknoView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText("Wybierz parę i okno.")).toBeInTheDocument();
});

it("bez pary/okna w URL wybór pary nawiguje z pierwszym dostępnym oknem", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/okno"]}>
        <Routes>
          <Route path="/okno" element={<OknoView />} />
          <Route path="/okno/:pairId/:windowId" element={<div>trafiono</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByRole("option", { name: "WETH/USDC" })).toBeInTheDocument());
  await userEvent.selectOptions(screen.getByLabelText("Para"), "1");
  await waitFor(() => expect(screen.getByText("trafiono")).toBeInTheDocument());
});
