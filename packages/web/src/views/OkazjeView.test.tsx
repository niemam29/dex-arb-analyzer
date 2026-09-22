// Dymny test widoku Okazje — tabela, filtry (przeładowanie listy zmienia query), paginacja i
// panel szczegółów po kliknięciu wiersza; z zamockowanym fetch, jak
// DaneView.test.tsx/OknoView.test.tsx.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { OpportunityListItem } from "@dex-arb/shared";
import { OkazjeView, okazjeStats } from "./OkazjeView";

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
const pairsBody2 = [
  ...pairsBody,
  { id: 2, symbol: "WBTC/WETH", token_base: "0x3", token_quote: "0x4", pools: [{ id: 3, dex_id: 1, dex_name: "Uniswap V2", address: "0xc" }] },
];
const windowsBody = [
  { id: 1, name: "maj 2021", from_ts: "2021-05-14T00:00:00Z", to_ts: "2021-05-26T00:00:00Z", from_block: 1, to_block: 1000 },
];
const modelsBody = [{ id: 1, name: "mamdani", kind: "mamdani", version: 1, created_at: "2026-01-01T00:00:00Z" }];
const oppsBody = {
  items: [
    { id: 1, block: 100, spread_pct: 1.0, direction: "a_to_b", est_profit_usd: 15, verification: null, scores: {} },
    {
      id: 2,
      block: 200,
      spread_pct: 0.7,
      direction: "b_to_a",
      est_profit_usd: -5,
      verification: {
        status: "decayed",
        route: null,
        consumer_tx_hash: null,
        realized_profit_usd: null,
        gas_used: null,
        gas_cost_usd: null,
        blocks_to_consumption: null,
        profitable_consumed: false,
        verified_at: null,
      },
      scores: {},
    },
  ],
  page: 1,
  page_size: 50,
  total: 2,
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function fetchMock(opps: unknown, onUrl?: (url: string) => void) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    onUrl?.(url);
    if (url.includes("/api/pairs/1/windows/1/opportunities")) return Promise.resolve(jsonResponse(opps));
    if (url.includes("/api/pairs")) return Promise.resolve(jsonResponse(pairsBody));
    if (url.includes("/api/windows")) return Promise.resolve(jsonResponse(windowsBody));
    if (url.includes("/api/models")) return Promise.resolve(jsonResponse(modelsBody));
    return Promise.reject(new Error(`nieoczekiwany fetch: ${url}`));
  });
}

afterEach(() => vi.unstubAllGlobals());

function renderView(path = "/okazje/1/1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/okazje/:pairId/:windowId" element={<OkazjeView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("renderuje tabelę okazji po załadowaniu danych", async () => {
  vi.stubGlobal("fetch", fetchMock(oppsBody));
  renderView();

  await waitFor(() => expect(screen.getByText("100")).toBeInTheDocument());
  expect(screen.getByText("200")).toBeInTheDocument();
  expect(screen.getAllByText("wygasła").some((el) => el.classList.contains("badge"))).toBe(true);
  expect(screen.getByText("2 okazji", { exact: false })).toBeInTheDocument();
});

it("bez pary/okna w URL pokazuje podpowiedź zamiast tabeli", () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("fetch", fetchMock(oppsBody));
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/okazje"]}>
        <Routes>
          <Route path="/okazje" element={<OkazjeView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText("Wybierz parę i okno.")).toBeInTheDocument();
});

it("zmiana filtra statusu przeładowuje listę z nowym query", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", fetchMock(oppsBody, (u) => urls.push(u)));
  renderView();
  await waitFor(() => expect(screen.getByText("100")).toBeInTheDocument());

  await userEvent.selectOptions(screen.getByLabelText("Status"), "decayed");

  await waitFor(() => expect(urls.some((u) => u.includes("status=decayed"))).toBe(true));
});

it("klik w wiersz wybiera okazję i pokazuje panel szczegółów", async () => {
  vi.stubGlobal("fetch", fetchMock(oppsBody));
  renderView();
  await waitFor(() => expect(screen.getByText("100")).toBeInTheDocument());

  expect(screen.getByText("Wybierz okazję.")).toBeInTheDocument();
  await userEvent.click(screen.getByText("100"));
  expect(screen.queryByText("Wybierz okazję.")).not.toBeInTheDocument();
});

it("zmiana pary/okna zeruje filtry, stronę i wybraną okazję poprzedniej listy", async () => {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/api/pairs/1/windows/1/opportunities")) return Promise.resolve(jsonResponse(oppsBody));
      if (url.includes("/api/pairs/2/windows/1/opportunities")) return Promise.resolve(jsonResponse({ items: [], page: 1, page_size: 50, total: 0 }));
      if (url.includes("/api/pairs")) return Promise.resolve(jsonResponse(pairsBody2));
      if (url.includes("/api/windows")) return Promise.resolve(jsonResponse(windowsBody));
      if (url.includes("/api/models")) return Promise.resolve(jsonResponse(modelsBody));
      return Promise.reject(new Error(`nieoczekiwany fetch: ${url}`));
    }),
  );
  renderView("/okazje/1/1?status=decayed&page=2");
  await waitFor(() => expect(screen.getByText("100")).toBeInTheDocument());
  await userEvent.click(screen.getByText("100"));
  expect(screen.queryByText("Wybierz okazję.")).not.toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText("Para"), "2");

  await waitFor(() => expect(urls.some((u) => u.includes("/api/pairs/2/windows/1/opportunities"))).toBe(true));
  const lastOppsUrl = urls.filter((u) => u.includes("/opportunities")).at(-1)!;
  expect(lastOppsUrl).not.toContain("status=");
  expect(lastOppsUrl).not.toContain("page=2");
  expect(screen.getByText("Wybierz okazję.")).toBeInTheDocument();
});

it("paginacja: strona 1/3, przycisk 'poprzednia' zablokowany, 'następna' aktywny", async () => {
  vi.stubGlobal("fetch", fetchMock({ ...oppsBody, page_size: 1, total: 3 }));
  renderView();

  await waitFor(() => expect(screen.getByText(/strona 1 \/ 3/)).toBeInTheDocument());
  expect(screen.getByRole("button", { name: /poprzednia/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /następna/ })).not.toBeDisabled();
});

it("okazjeStats: bloki z okna, okazje z total, atomowe (+multi) i mediana zysku two_pool z pobranej strony", () => {
  const items = [
    { ...oppsBody.items[0]!, verification: { status: "consumed_atomic" as const, route: "two_pool" as const, consumer_tx_hash: "0x1", realized_profit_usd: 10, gas_used: "1", gas_cost_usd: 1, blocks_to_consumption: 1, profitable_consumed: true, verified_at: null } },
    { ...oppsBody.items[0]!, id: 9, verification: { status: "consumed_atomic" as const, route: "two_pool" as const, consumer_tx_hash: "0x2", realized_profit_usd: 30, gas_used: "1", gas_cost_usd: 1, blocks_to_consumption: 1, profitable_consumed: true, verified_at: null } },
    { ...oppsBody.items[0]!, id: 10, verification: { status: "consumed_atomic" as const, route: "multi" as const, consumer_tx_hash: "0x3", realized_profit_usd: null, gas_used: "1", gas_cost_usd: 1, blocks_to_consumption: 0, profitable_consumed: false, verified_at: null } },
    oppsBody.items[1]!,
  ];
  // `oppsBody` to literał pod fetch-mock (status jako string) — rzutujemy na typ DTO.
  const stats = okazjeStats(items as unknown as OpportunityListItem[], 655, windowsBody[0]);
  expect(stats.map((s) => s.label)).toEqual(["Bloki w oknie", "Okazje", "Skonsumowane atomowo", "Mediana zysku two_pool"]);
  expect(stats[0]!.value).toBe("1000");
  expect(stats[1]!.value).toBe("655");
  expect(stats[2]!.value).toBe("3 (w tym 1 multi)");
  expect(stats[2]!.hint).toBe("na tej stronie");
  expect(stats[3]!.value).toBe("20 $");
  expect(stats[3]!.hint).toBe("na tej stronie");
});

it("renderuje PageHeader z okruszkami para/okno i KPI", async () => {
  vi.stubGlobal("fetch", fetchMock(oppsBody));
  renderView();
  await waitFor(() => expect(screen.getByText("100")).toBeInTheDocument());
  expect(screen.getByRole("navigation", { name: "Okruszki" }).textContent).toBe("Okazje / WETH/USDC / maj 2021");
  expect(screen.getByText("Okazje", { selector: ".stat-label" }).nextElementSibling).toHaveTextContent("2");
});

it("bez pary/okna w URL wybór pary nawiguje z pierwszym dostępnym oknem", async () => {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      urls.push(url);
      if (url.includes("/api/pairs")) return Promise.resolve(jsonResponse(pairsBody2));
      if (url.includes("/api/windows")) return Promise.resolve(jsonResponse(windowsBody));
      if (url.includes("/api/models")) return Promise.resolve(jsonResponse(modelsBody));
      return Promise.reject(new Error(`nieoczekiwany fetch: ${url}`));
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/okazje"]}>
        <Routes>
          <Route path="/okazje" element={<OkazjeView />} />
          <Route path="/okazje/:pairId/:windowId" element={<div>trafiono: {location.pathname}</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByRole("option", { name: "WBTC/WETH" })).toBeInTheDocument());
  await userEvent.selectOptions(screen.getByLabelText("Para"), "2");
  await waitFor(() => expect(screen.getByText(/trafiono/)).toBeInTheDocument());
});
