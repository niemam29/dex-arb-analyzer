// Wykresy widoku Okno w jsdom: Recharts nie renderuje SVG bez layoutu, więc sprawdzamy tylko
// kartę (tytuł, kontekst) i stałe konfiguracyjne (kolory z theme.ts).
import { it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriceChart } from "./PriceChart";
import { GasChart } from "./GasChart";
import { ScoreChart } from "./ScoreChart";
import { MODEL_COLORS } from "./chartUtils";
import type { ChartRow } from "./chartUtils";

const rows: ChartRow[] = [
  { block: 1000, label: "#1000", ts: null, price_a: 4000, price_b: 4004, spread_avg: 0.3, spread_min: 0.1, spread_max: 0.5, gas_median: 120 },
];

it("PriceChart renderuje kartę z domyślnym tytułem i kontekstem, nadpisywalnym przez props", () => {
  const { rerender } = render(<PriceChart rows={rows} poolA="Uniswap V2" poolB="Sushiswap" />);
  expect(screen.getByRole("heading", { name: "Cena" })).toBeInTheDocument();
  expect(screen.getByText("USDC za 1 WETH · ostatnia w kubełku")).toHaveClass("card-meta");
  rerender(<PriceChart rows={rows} poolA="Uniswap V2" poolB="Sushiswap" title="Cena WETH/USDC" meta="maj 2021" />);
  expect(screen.getByRole("heading", { name: "Cena WETH/USDC" })).toBeInTheDocument();
  expect(screen.getByText("maj 2021")).toHaveClass("card-meta");
});

it("GasChart i ScoreChart renderują karty z tytułami", () => {
  render(
    <>
      <GasChart rows={rows} />
      <ScoreChart rows={rows} models={[{ id: 1, name: "mamdani-v1", kind: "mamdani" }]} />
    </>,
  );
  expect(screen.getByRole("heading", { name: "Gaz" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Score modeli" })).toBeInTheDocument();
  expect(document.querySelectorAll(".chart-card")).toHaveLength(2);
});

it("chartUtils re-eksportuje MODEL_COLORS z theme.ts (fallback heksów w jsdom)", () => {
  expect(MODEL_COLORS.mamdani).toBe("#d97706");
  expect(MODEL_COLORS.anfis).toBe("#4f46e5");
});
