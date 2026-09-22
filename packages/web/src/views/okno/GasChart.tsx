// Mediana ceny gazu [gwei] w kubełku — kontekst dla progu wykonalności arbitrażu (koszt tx vs
// spread).
import type { ReactNode } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { ChartRow } from "./chartUtils";
import { Card } from "../../components/ui/Card";
import { chartTheme } from "../../chartTheme";
import { cssVar } from "../../theme";

export type GasChartProps = { rows: ChartRow[]; title?: string; meta?: ReactNode };

export function GasChart({ rows, title = "Gaz", meta = "gwei · mediana w kubełku" }: GasChartProps) {
  const t = chartTheme();
  return (
    <Card title={title} meta={meta} className="chart-card">
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={rows} syncId="okno" margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid {...t.grid} vertical={false} />
          <XAxis dataKey="label" minTickGap={60} tick={t.tick} axisLine={t.axisLine} tickLine={t.tickLine} />
          <YAxis unit=" gwei" width={72} tick={t.tick} axisLine={false} tickLine={t.tickLine} />
          <Tooltip {...t.tooltip} formatter={(v) => (typeof v === "number" ? `${v.toFixed(1)} gwei` : v)} />
          <Line dataKey="gas_median" name="gaz (mediana)" dot={false} stroke={cssVar("--warn")} strokeWidth={1.5} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
