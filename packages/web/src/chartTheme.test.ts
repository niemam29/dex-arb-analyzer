// packages/web/src/chartTheme.test.ts
import { it, expect } from "vitest";
import { chartTheme } from "./chartTheme";

it("chartTheme zwraca wspólne ustawienia Recharts oparte na tokenach (fallback w jsdom)", () => {
  const t = chartTheme();
  expect(t.grid).toEqual({ stroke: "#eef0f2", strokeDasharray: "3 3" });
  expect(t.tick).toEqual({ fontSize: 11, fill: "#6b7280" });
  expect(t.axisLine).toEqual({ stroke: "#e5e7eb" });
  expect(t.tickLine).toBe(false);
  expect(t.tooltip.contentStyle.background).toBe("#ffffff");
  expect(t.tooltip.contentStyle.border).toBe("1px solid #e5e7eb");
  expect(t.legend.wrapperStyle.fontSize).toBe(12);
});
