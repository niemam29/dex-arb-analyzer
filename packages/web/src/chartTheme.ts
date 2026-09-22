// packages/web/src/chartTheme.ts
// Wspólne ustawienia Recharts (siatka, osie, tooltip w stylu karty, legenda pod wykresem) —
// jedna funkcja, bo wartości tokenów czytamy leniwie (patrz theme.ts). Użycie:
//   const t = chartTheme();
//   <CartesianGrid {...t.grid} /> <XAxis tick={t.tick} axisLine={t.axisLine} tickLine={t.tickLine} />
//   <Tooltip {...t.tooltip} /> <Legend {...t.legend} />
import type { CSSProperties } from "react";
import { cssVar } from "./theme";

export type ChartTheme = {
  grid: { stroke: string; strokeDasharray: string };
  axisLine: { stroke: string };
  tickLine: false;
  tick: { fontSize: number; fill: string };
  tooltip: { contentStyle: CSSProperties; labelStyle: CSSProperties; itemStyle: CSSProperties };
  legend: { wrapperStyle: CSSProperties; iconSize: number };
};

export const CHART_FONT = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";

export function chartTheme(): ChartTheme {
  return {
    grid: { stroke: cssVar("--border-soft"), strokeDasharray: "3 3" },
    axisLine: { stroke: cssVar("--border") },
    tickLine: false,
    tick: { fontSize: 11, fill: cssVar("--fg-muted") },
    tooltip: {
      contentStyle: {
        background: cssVar("--surface"),
        border: `1px solid ${cssVar("--border")}`,
        borderRadius: 8,
        boxShadow: "0 1px 2px rgba(0,0,0,.04)",
        fontFamily: CHART_FONT,
        fontSize: 12.5,
        padding: "6px 10px",
      },
      labelStyle: { color: cssVar("--fg-muted"), fontSize: 11, marginBottom: 4 },
      itemStyle: { color: cssVar("--fg"), padding: 0 },
    },
    legend: { wrapperStyle: { fontSize: 12, paddingTop: 8, fontFamily: CHART_FONT }, iconSize: 10 },
  };
}
