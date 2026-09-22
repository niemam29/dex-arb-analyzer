// Wynik oceny wykonalności [0-100] per model (baseline/baseline_v2/mamdani/anfis) — jedna linia
// na model obecny w `SeriesResponse.models` (kolumny `m<id>` z chartUtils); kolor po `kind`
// z theme.ts (jedyne źródło kolorów modeli).
import type { ReactNode } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import type { SeriesResponse } from "@dex-arb/shared";
import type { ChartRow } from "./chartUtils";
import { Card } from "../../components/ui/Card";
import { chartTheme } from "../../chartTheme";
import { modelColor } from "../../theme";

export type ScoreChartProps = { rows: ChartRow[]; models: SeriesResponse["models"]; title?: string; meta?: ReactNode };

// Wzory kreski per pozycja w obrębie tego samego `kind` (kolor po kind — theme.ts — więc dwa
// modele tego samego rodzaju, np. dwie wersje ANFIS, mają ten sam kolor; kreska je odróżnia).
const DASH_BY_INDEX = ["", "4 2", "1 3"];

export function ScoreChart({ rows, models, title = "Score modeli", meta = "0–100 · średnia w kubełku" }: ScoreChartProps) {
  const t = chartTheme();
  const kindIndex = new Map<string, number>();
  return (
    <Card title={title} meta={meta} className="chart-card">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={rows} syncId="okno" margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid {...t.grid} vertical={false} />
          <XAxis dataKey="label" minTickGap={60} tick={t.tick} axisLine={t.axisLine} tickLine={t.tickLine} />
          <YAxis domain={[0, 100]} width={64} tick={t.tick} axisLine={false} tickLine={t.tickLine} />
          <Tooltip {...t.tooltip} formatter={(v) => (typeof v === "number" ? v.toFixed(1) : v)} />
          <Legend {...t.legend} />
          {models.map((m) => {
            const i = kindIndex.get(m.kind) ?? 0;
            kindIndex.set(m.kind, i + 1);
            return (
              <Line
                key={m.id}
                dataKey={`m${m.id}`}
                name={`${m.name} (${m.kind})`}
                dot={false}
                stroke={modelColor(m.kind)}
                strokeDasharray={DASH_BY_INDEX[i % DASH_BY_INDEX.length] ?? ""}
                strokeWidth={1.5}
                isAnimationActive={false}
                connectNulls
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
