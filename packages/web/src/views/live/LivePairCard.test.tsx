import { it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LivePairDto, LivePointDto } from "@dex-arb/shared";
import { LivePairCard, directionLabel, scoreBadgeText, scoreTone } from "./LivePairCard";

const scores = {
  baseline: { score: 19.96, label: "wykonalna" },
  mamdani: { score: 40, label: "ryzykowna" },
  baseline_v2: null,
  anfis: { score: 91.4, label: "atrakcyjna" },
};
const pair: LivePairDto = {
  pair_id: 1,
  symbol: "WETH/USDC",
  pool_a: { dex_name: "uniswap-v2", price: 2296.3 },
  pool_b: { dex_name: "sushiswap", price: 2319.57 },
  spread_pct: 1.0134,
  direction: "a_to_b",
  opt_trade_usd: 141015.29,
  gross_profit_usd: 287.54,
  net_profit_usd: 281.48,
  tvl_min_usd: 225856851.8,
  features: { s: 1.0134, g: 0.0121, l: 100, m: 50 },
  swaps_per_block: 0.15,
  scores,
};
const history: LivePointDto[] = [{ at: "2026-08-27T10:00:00.000Z", block: 23000000, spread_pct: 1.0134, net_profit_usd: 281.48, scores }];

it("karta pary: tytuł, kierunek, ceny obu pul, spread z klasą profit, netto, TVL, cechy i 4 pigułki", () => {
  render(<LivePairCard pair={pair} history={history} thresholdPct={0.65} />);
  expect(screen.getByRole("heading", { name: "WETH/USDC" })).toBeInTheDocument();
  expect(screen.getByText("kup uniswap-v2 → sprzedaj sushiswap")).toBeInTheDocument();
  expect(screen.getByText("uniswap-v2").closest(".live-price")).toHaveClass("live-price--a");
  expect(screen.getByText("sushiswap").closest(".live-price")).toHaveClass("live-price--b");
  const spread = screen.getByTestId("live-spread");
  expect(spread).toHaveTextContent("1,013 %");
  expect(spread).toHaveClass("profit");
  expect(screen.getByText("Zysk netto").nextElementSibling).toHaveTextContent("281,48 $");
  expect(screen.getByText("Optymalna transakcja").nextElementSibling).toHaveTextContent("141 015,29 $");
  expect(screen.getByText("TVL (płytsza pula)").nextElementSibling).toHaveTextContent("225 856 851,8 $");
  expect(screen.getByText("S / G / L / M").nextElementSibling).toHaveTextContent("1,013 / 0,012 / 100 / 50");
  expect(screen.getByTitle(/percentyle liczone po historii próbek z ostatniej godziny/)).toBeInTheDocument();
  expect(screen.getByTitle(/swapy: średnia z ostatnich 20 bloków obu puli/)).toBeInTheDocument();
  expect(screen.getByText("Baseline 20,0 · wykonalna")).toHaveClass("badge--accent");
  expect(screen.getByText("Mamdani 40,0 · ryzykowna")).toHaveClass("badge--warn");
  expect(screen.getByText("Baseline v2 —")).toHaveClass("badge--muted");
  expect(screen.getByText("ANFIS 91,4 · atrakcyjna")).toHaveClass("badge--ok");
  expect(screen.getByRole("img", { name: /Spread z ostatniej godziny/ })).toBeInTheDocument();
});

it("spread poniżej progu bez klasy profit; brak kierunku -> „brak kierunku”, netto i optymalna transakcja jako „—”", () => {
  render(<LivePairCard pair={{ ...pair, spread_pct: 0.1, direction: "none" }} history={[]} thresholdPct={0.65} />);
  expect(screen.getByTestId("live-spread")).not.toHaveClass("profit");
  expect(screen.getByText("brak kierunku")).toBeInTheDocument();
  expect(screen.getByText("Zysk netto").nextElementSibling).toHaveTextContent("—");
  expect(screen.getByText("Optymalna transakcja").nextElementSibling).toHaveTextContent("—");
});

it("helpery: scoreTone, scoreBadgeText, directionLabel", () => {
  expect(scoreTone("atrakcyjna")).toBe("ok");
  expect(scoreTone("wykonalna")).toBe("accent");
  expect(scoreTone("ryzykowna")).toBe("warn");
  expect(scoreTone("niewykonalna")).toBe("muted");
  expect(scoreTone(null)).toBe("muted");
  expect(scoreBadgeText("anfis", { score: 91.44, label: "atrakcyjna" })).toBe("ANFIS 91,4 · atrakcyjna");
  expect(scoreBadgeText("baseline_v2", null)).toBe("Baseline v2 —");
  expect(directionLabel({ direction: "b_to_a", pool_a: pair.pool_a, pool_b: pair.pool_b })).toBe("kup sushiswap → sprzedaj uniswap-v2");
});
