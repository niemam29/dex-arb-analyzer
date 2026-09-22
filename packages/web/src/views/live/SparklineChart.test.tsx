// Recharts nie renderuje w jsdom nic mierzalnego (ResponsiveContainer bez layoutu) — testujemy
// wrapper: rolę img z opisem progu oraz stan pusty.
import { it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SparklineChart } from "./SparklineChart";

const points = [
  { at: "2026-08-27T10:00:00.000Z", spread_pct: 0.2 },
  { at: "2026-08-27T10:00:15.000Z", spread_pct: 0.9 },
];

it("renderuje wrapper .sparkline z opisem progu i wysokością 120 px", () => {
  render(<SparklineChart points={points} thresholdPct={0.65} />);
  const el = screen.getByRole("img", { name: "Spread z ostatniej godziny, próg 0,650 %" });
  expect(el).toHaveClass("sparkline");
  expect(el).toHaveStyle({ height: "120px" });
});

it("bez punktów pokazuje tekst zamiast wykresu", () => {
  render(<SparklineChart points={[]} thresholdPct={0.65} />);
  expect(screen.getByText("brak historii")).toBeInTheDocument();
  expect(screen.queryByRole("img")).toBeNull();
});

it("próg poza skalą danych: dopisek „· poza skalą” w opisie", () => {
  const lowSpread = [
    { at: "2026-08-27T10:00:00.000Z", spread_pct: 0.01 },
    { at: "2026-08-27T10:00:15.000Z", spread_pct: 0.02 },
  ];
  render(<SparklineChart points={lowSpread} thresholdPct={0.65} />);
  expect(screen.getByRole("img", { name: "Spread z ostatniej godziny, próg 0,650 % · poza skalą" })).toBeInTheDocument();
});
