// Helpery kształtujące wiersze wykresów widoku Okno z `SeriesResponse` — spłaszczenie `scores`
// (mapa model_id -> score) do kolumn `m<id>` i etykiety osi X z bloku (+ znacznika czasu, gdy
// znany).
import { it, expect } from "vitest";
import { toChartRows, fmtBlockLabel } from "./chartUtils";

it("spłaszcza scores do kolumn m<id> i tworzy etykietę z to_block (ts to max czasu kubełka)", () => {
  const rows = toChartRows({
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
  });
  expect(rows[0]).toMatchObject({ block: 1000, price_a: 4000, spread_max: 0.5, m1: 20 });
  // Etykieta jawnie w UTC (fmtBlockLabel) — niezależna od strefy maszyny test runnera.
  expect(rows[0]!.label).toBe("#1004 14.05.2021 00:10");
});

it("fmtBlockLabel bez ts → sam numer bloku", () => {
  expect(fmtBlockLabel(1000, null)).toBe("#1000");
});

it("fmtBlockLabel z ts → data i czas w UTC, niezależnie od strefy maszyny", () => {
  expect(fmtBlockLabel(1004, "2021-05-14T00:10:00.000Z")).toBe("#1004 14.05.2021 00:10");
  expect(fmtBlockLabel(2000, "2022-11-18T23:59:30.000Z")).toBe("#2000 18.11.2022 23:59");
});
