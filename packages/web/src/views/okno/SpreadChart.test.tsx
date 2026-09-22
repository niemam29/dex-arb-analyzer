// Korytarz min–max na wykresie spreadu jest rysowany jako dwie stackowane Areas (przezroczysta
// baza `spread_min` + widoczny `band = spread_max - spread_min`), nie jako pojedyncza Area od 0
// do `spread_max` (co dawało klin, nie pas). Testujemy helper kształtujący dane (`withBand`)
// oraz dymnie, że komponent faktycznie renderuje obie Areas.
//
// Uwaga: `ResponsiveContainer` w jsdom nie ma prawdziwego layoutu (brak ResizeObserver i
// realnego `getBoundingClientRect`), więc bez tych mocków w ogóle nie renderuje dzieci (patrz
// uzasadnienie w OknoView.test.tsx) — nawet z mockami sam SVG bywa niekompletny (np. YAxis nie
// dostaje wysokości plotu w jsdom), więc zamiast parsować wyrenderowany DOM, podglądamy same
// wywołania komponentu `Area` z `recharts` (React.memo → realna funkcja renderująca w `.type`).
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import * as Recharts from "recharts";
import { SpreadChart, withBand, thresholdLabel } from "./SpreadChart";
import type { ChartRow } from "./chartUtils";

const rows: ChartRow[] = [
  {
    block: 1000,
    label: "#1000",
    ts: null,
    price_a: 4000,
    price_b: 4004,
    spread_avg: 0.3,
    spread_min: 0.1,
    spread_max: 0.5,
    gas_median: 120,
  },
  {
    block: 1005,
    label: "#1005",
    ts: null,
    price_a: 4010,
    price_b: 4006,
    spread_avg: 0.2,
    spread_min: null,
    spread_max: null,
    gas_median: 118,
  },
];

it("withBand liczy band = max - min i przepuszcza null, gdy brak danych", () => {
  const out = withBand(rows);
  expect(out[0]).toMatchObject({ block: 1000, spread_min: 0.1, spread_max: 0.5, band: 0.4 });
  expect(out[1]).toMatchObject({ block: 1005, band: null });
});

class ResizeObserverStub {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element) {
    this.cb([{ contentRect: target.getBoundingClientRect() } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  // `ResponsiveContainer` (width="100%") potrzebuje realnych wymiarów, których jsdom nie liczy —
  // stub ResizeObserver + stała `getBoundingClientRect` dają mu 800×300, żeby w ogóle
  // wyrenderował dzieci (patrz `isAcceptableSize` w recharts/ResponsiveContainer.js).
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 800,
    height: 300,
    top: 0,
    left: 0,
    bottom: 300,
    right: 800,
    x: 0,
    y: 0,
    toJSON() {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("renderuje pas min–max jako dwie stackowane Areas (baza + band), nie klin od zera", () => {
  const areaSpy = vi.spyOn(Recharts.Area as unknown as { type: (...args: unknown[]) => unknown }, "type");
  render(<SpreadChart rows={rows} thresholdPct={0.65} onBrush={() => {}} />);

  expect(areaSpy).toHaveBeenCalledTimes(2);
  const calls = areaSpy.mock.calls as unknown as Array<[{ dataKey: string; stackId: string }]>;
  expect(calls.map(([props]) => props.dataKey)).toEqual(["spread_min", "band"]);
  expect(calls.every(([props]) => props.stackId === "band")).toBe(true);
});

it("etykieta progu jest pozycjonowana insideTopRight (nie wypada poza SVG) i używa koloru danger", () => {
  expect(thresholdLabel(0.65)).toEqual({ value: "próg 0.65 %", position: "insideTopRight", fill: "#dc2626", fontSize: 11 });
});

it("wykres jest w karcie z tytułem 'Spread [%]' i kontekstem progu", () => {
  render(<SpreadChart rows={rows} thresholdPct={0.65} onBrush={() => {}} />);
  expect(screen.getByRole("heading", { name: "Spread [%]" })).toBeInTheDocument();
  expect(screen.getByText("próg 0.65 % · pasmo min–max")).toHaveClass("card-meta");
});
