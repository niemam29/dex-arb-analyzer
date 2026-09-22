// Spread [%] — pasmo min/max (Area) + średnia (Line), linia progu `SPREAD_THRESHOLD_PCT` (suma
// prowizji 2×0,3%, patrz docs/konwencje.md), i Brush sterujący zakresem całego widoku Okno (jedyny
// wykres z brushem — pozostałe dostają te same wiersze przez syncId). Etykieta progu
// `insideTopRight` — `position="right"` wypadała poza SVG.
import type { ReactNode } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  Brush,
} from "recharts";
import type { ChartRow } from "./chartUtils";
import { Card } from "../../components/ui/Card";
import { chartTheme } from "../../chartTheme";
import { cssVar } from "../../theme";

export type SpreadChartProps = {
  rows: ChartRow[];
  thresholdPct: number;
  onBrush: (startIndex: number, endIndex: number) => void;
  title?: string;
  meta?: ReactNode;
};

// `<Area dataKey="spread_max">` samo w sobie rysuje klin od 0, nie korytarz min–max. Recharts
// robi korytarz przez dwie Areas na wspólnym `stackId`: pierwsza (przezroczysta, bez
// legendy/tooltipa) unosi się do `spread_min`, druga dokłada `band = spread_max - spread_min`,
// więc widoczny pas zaczyna się od `spread_min`, nie od 0.
export type SpreadRow = ChartRow & { band: number | null };

export function withBand(rows: ChartRow[]): SpreadRow[] {
  return rows.map((r) => ({
    ...r,
    band: r.spread_max != null && r.spread_min != null ? r.spread_max - r.spread_min : null,
  }));
}

export function thresholdLabel(pct: number): { value: string; position: "insideTopRight"; fill: string; fontSize: number } {
  return { value: `próg ${pct} %`, position: "insideTopRight", fill: cssVar("--danger"), fontSize: 11 };
}

export function SpreadChart({ rows, thresholdPct, onBrush, title = "Spread [%]", meta }: SpreadChartProps) {
  const data = withBand(rows);
  const t = chartTheme();
  return (
    <Card title={title} meta={meta ?? `próg ${thresholdPct} % · pasmo min–max`} className="chart-card">
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} syncId="okno" margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid {...t.grid} vertical={false} />
          <XAxis dataKey="label" minTickGap={60} tick={t.tick} axisLine={t.axisLine} tickLine={t.tickLine} />
          <YAxis unit="%" width={64} tick={t.tick} axisLine={false} tickLine={t.tickLine} />
          <Tooltip {...t.tooltip} formatter={(v) => (typeof v === "number" ? `${v.toFixed(3)} %` : v)} />
          <Legend {...t.legend} />
          <Area
            dataKey="spread_min"
            stackId="band"
            name="dolna granica"
            stroke="none"
            fill="transparent"
            legendType="none"
            tooltipType="none"
            isAnimationActive={false}
          />
          <Area dataKey="band" stackId="band" name="zakres min–max" stroke="none" fill={cssVar("--info")} fillOpacity={0.18} isAnimationActive={false} />
          <Line dataKey="spread_avg" name="spread śr." dot={false} stroke={cssVar("--info")} strokeWidth={1.5} isAnimationActive={false} />
          <ReferenceLine y={thresholdPct} stroke={cssVar("--danger")} strokeDasharray="4 4" label={thresholdLabel(thresholdPct)} />
          <Brush
            dataKey="block"
            height={24}
            travellerWidth={8}
            stroke={cssVar("--border")}
            onChange={(r) => {
              if (r && r.startIndex != null && r.endIndex != null) onBrush(r.startIndex, r.endIndex);
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
}
