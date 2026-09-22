// Cena w obu pulach (ostatnia w kubełku) — para linii A (np. Uniswap V2, --pool-a) i B (np.
// Sushiswap, --pool-b), wspólna oś X (bloki) z pozostałymi wykresami widoku Okno (syncId).
import type { ReactNode } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import type { ChartRow } from "./chartUtils";
import { Card } from "../../components/ui/Card";
import { chartTheme } from "../../chartTheme";
import { POOL_COLORS } from "../../theme";

export type PriceChartProps = { rows: ChartRow[]; poolA: string; poolB: string; title?: string; meta?: ReactNode };

export function PriceChart({ rows, poolA, poolB, title = "Cena", meta = "USDC za 1 WETH · ostatnia w kubełku" }: PriceChartProps) {
  const t = chartTheme();
  return (
    <Card title={title} meta={meta} className="chart-card">
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={rows} syncId="okno" margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid {...t.grid} vertical={false} />
          <XAxis dataKey="label" minTickGap={60} tick={t.tick} axisLine={t.axisLine} tickLine={t.tickLine} />
          <YAxis domain={["auto", "auto"]} tickFormatter={(v: number) => v.toFixed(0)} width={64} tick={t.tick} axisLine={false} tickLine={t.tickLine} />
          <Tooltip {...t.tooltip} formatter={(v) => (typeof v === "number" ? v.toFixed(2) : v)} />
          <Legend {...t.legend} />
          <Line type="monotone" dataKey="price_a" name={poolA} dot={false} stroke={POOL_COLORS.a} strokeWidth={1.5} isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey="price_b" name={poolB} dot={false} stroke={POOL_COLORS.b} strokeWidth={1.5} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
