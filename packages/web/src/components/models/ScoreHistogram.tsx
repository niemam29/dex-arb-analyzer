// Histogram score modelu: skonsumowane z zyskiem vs pozostałe — `histogram`
// z EvaluationDto ma `edges.length === positive.length + 1`. Oś Y w skali pierwiastkowej, bo
// klasa pozytywna jest silnie mniejszościowa (patrz docs/konwencje.md — 0,07% okazji "wykonalna").
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ScoreHistogramDto } from "@dex-arb/shared";
import { Card } from "../ui/Card";
import { chartTheme } from "../../chartTheme";
import { cssVar } from "../../theme";

export type ScoreHistogramProps = { histogram: ScoreHistogramDto; title: string; meta?: ReactNode };

export function ScoreHistogram({ histogram: h, title, meta = "oś Y w skali pierwiastkowej — klasy silnie niezbalansowane" }: ScoreHistogramProps) {
  const t = chartTheme();
  const data = h.positive.map((p, i) => ({
    bin: `${h.edges[i]}–${h.edges[i + 1]}`,
    skonsumowane: p,
    nieskonsumowane: h.negative[i],
  }));
  return (
    <Card title={title} meta={meta} className="chart-card">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...t.grid} vertical={false} />
          <XAxis dataKey="bin" interval={3} tick={t.tick} axisLine={t.axisLine} tickLine={t.tickLine} />
          <YAxis scale="sqrt" allowDecimals={false} tick={t.tick} axisLine={false} tickLine={t.tickLine} width={48} />
          <Tooltip {...t.tooltip} cursor={{ fill: cssVar("--muted-soft") }} />
          <Legend {...t.legend} />
          <Bar dataKey="nieskonsumowane" name="pozostałe" fill={cssVar("--fg-muted")} fillOpacity={0.45} isAnimationActive={false} />
          <Bar dataKey="skonsumowane" name="skonsumowane z zyskiem" fill={cssVar("--ok")} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
