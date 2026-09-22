import type { ReactElement } from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OpportunityDetailPanel } from "./OpportunityDetail";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const detailBody = {
  id: 1,
  pair_id: 1,
  window_id: 1,
  block: 12430000,
  spread_pct: 1.2,
  direction: "a_to_b",
  est_profit_usd: 15,
  verification: {
    status: "consumed_atomic",
    route: "two_pool",
    consumer_tx_hash: "0xabc",
    realized_profit_usd: 20,
    gas_used: "200000",
    gas_cost_usd: 60,
    blocks_to_consumption: 1,
    profitable_consumed: false,
    verified_at: "2021-05-14T00:01:00Z",
  },
  scores: {},
  price_a: 3000,
  price_b: 3030,
  tvl_min_usd: 50_000_000,
  gas_price_median: 100,
  s: 1.2,
  g: 0.2,
  l: 50,
  m: 40,
  opt_trade_usd: 20000,
  baseline_net_profit_usd: 15,
  baseline_feasible: true,
  reserves: [
    { pool_id: 1, dex_name: "uniswap", block: 99, reserve0: "150000000000", reserve1: "50000000000000000000" },
    { pool_id: 2, dex_name: "sushiswap", block: 98, reserve0: "30300000000", reserve1: "10000000000000000000" },
  ],
  rule_activations: [
    { id: "R1", strength: 0 },
    { id: "R7", strength: 0.6 },
  ],
  etherscan_url: "https://etherscan.io/tx/0xabc",
};

afterEach(() => vi.unstubAllGlobals());

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

it("pokazuje podpowiedź, gdy nie wybrano okazji", () => {
  wrap(<OpportunityDetailPanel id={null} />);
  expect(screen.getByText("Wybierz okazję.")).toBeInTheDocument();
});

it("renderuje rezerwy, cechy, aktywacje reguł, weryfikację i link do Etherscan", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(detailBody))));
  wrap(<OpportunityDetailPanel id={1} />);

  expect(await screen.findByText("uniswap")).toBeInTheDocument();
  expect(screen.getByText("sushiswap")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /etherscan/i })).toHaveAttribute("href", "https://etherscan.io/tx/0xabc");
  expect(screen.getByText("Zysk realny (brutto)")).toBeInTheDocument();
  expect(screen.getByText(/nieopłacalna po gazie/i)).toBeInTheDocument();
  expect(screen.getByText("trasa: 2 pule")).toBeInTheDocument();
  expect(screen.getAllByRole("progressbar")).toHaveLength(2);
  expect(screen.getByText("100 gwei")).toBeInTheDocument();
  expect(screen.getByText(/A→B \(Uniswap→Sushi\)/)).toBeInTheDocument();
  expect(screen.getByRole("table", { name: /rezerwy w bloku/i })).toBeInTheDocument();
});

it("bez weryfikacji (decayed, brak tx) nie pokazuje linku do Etherscan", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          ...detailBody,
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
          etherscan_url: null,
        }),
      ),
    ),
  );
  wrap(<OpportunityDetailPanel id={2} />);

  await waitFor(() => expect(screen.getAllByText("wygasła")).toHaveLength(2));
  expect(screen.queryByRole("link", { name: /etherscan/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/zysk realny \(brutto\)/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/nieopłacalna po gazie/i)).not.toBeInTheDocument();
  expect(screen.getByText(/nie została skonsumowana atomowo/i)).toBeInTheDocument();
  expect(screen.queryByText(/^trasa:/i)).not.toBeInTheDocument();
});

it("consumed_atomic z route='multi' (zysk nieznany): pokazuje trasę wielopulową, NIE 'nieopłacalna po gazie'", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          ...detailBody,
          verification: {
            ...detailBody.verification,
            route: "multi",
            realized_profit_usd: null,
            gas_used: "350000",
            gas_cost_usd: 90,
            profitable_consumed: false,
          },
        }),
      ),
    ),
  );
  wrap(<OpportunityDetailPanel id={3} />);

  expect(await screen.findByText("trasa: wielopulowa — zysk nieznany")).toBeInTheDocument();
  expect(screen.queryByText(/nieopłacalna po gazie/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/zysk realny \(brutto\)/i)).not.toBeInTheDocument();
  expect(screen.queryByText("Netto")).not.toBeInTheDocument();
  expect(screen.getByText(/zysk dwupulowy nie jest policzalny/i)).toBeInTheDocument();
  // gaz nadal znany (tx istnieje) — pokazany
  expect(screen.getByText(/350000 × cena/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /etherscan/i })).toBeInTheDocument();
});

it("panel jest kartą: status jako Badge, hash skrócony monospace z pełnym title, netto w klasie loss", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ ...detailBody, verification: { ...detailBody.verification, consumer_tx_hash: "0x1234567890abcdef1234567890abcdef12345678" } }))));
  wrap(<OpportunityDetailPanel id={1} />);
  expect(await screen.findByRole("heading", { name: "Okazja #1 · blok 12430000" })).toBeInTheDocument();
  // status jest DWA razy: w meta karty i w sekcji „Weryfikacja retrospektywna”
  const badges = screen.getAllByText("skonsumowana (atomowo)");
  expect(badges).toHaveLength(2);
  expect(badges[0]).toHaveClass("badge", "badge--ok");
  const hash = screen.getByText("0x123456…345678");
  expect(hash).toHaveClass("mono");
  expect(hash).toHaveAttribute("title", "0x1234567890abcdef1234567890abcdef12345678");
  expect(screen.getByText(/nieopłacalna po gazie/i)).toHaveClass("loss");
  expect(document.querySelectorAll("dl.detail").length).toBeGreaterThanOrEqual(3);
});
