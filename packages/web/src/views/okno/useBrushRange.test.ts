// Hook mapujący indeksy brusha Recharts (SpreadChart) na zakres bloków `{from, to}` wysyłany
// do `useSeries`, z debounce 300 ms (żeby przeciąganie nie odpalało requestu na każdą klatkę)
// i zerowaniem zakresu, gdy brush obejmuje całe okno.
import { it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBrushRange } from "./useBrushRange";

const pt = (from: number, to: number) => ({
  from_block: from,
  to_block: to,
  ts: null,
  price_a: null,
  price_b: null,
  spread_avg: null,
  spread_min: null,
  spread_max: null,
  gas_median: null,
  scores: {},
});

it("domyślnie cały zakres okna; brush ustawia from/to z wybranych punktów po debounce", () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useBrushRange({ from_block: 1000, to_block: 1999 }));
  expect(result.current.range).toEqual({ from: undefined, to: undefined });
  const points = [pt(1000, 1099), pt(1100, 1199), pt(1200, 1299), pt(1300, 1399)];
  act(() => result.current.setFromBrush(points, 1, 2));
  expect(result.current.range).toEqual({ from: undefined, to: undefined }); // jeszcze debounce
  act(() => {
    vi.advanceTimersByTime(350);
  });
  expect(result.current.range).toEqual({ from: 1100, to: 1299 });
  act(() => result.current.reset());
  expect(result.current.range).toEqual({ from: undefined, to: undefined });
  vi.useRealTimers();
});

it("brush obejmujący wszystko nie zmienia zakresu", () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useBrushRange({ from_block: 1000, to_block: 1199 }));
  act(() => result.current.setFromBrush([pt(1000, 1099), pt(1100, 1199)], 0, 1));
  act(() => {
    vi.advanceTimersByTime(350);
  });
  expect(result.current.range).toEqual({ from: undefined, to: undefined });
  vi.useRealTimers();
});
