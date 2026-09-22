// Krzywe ROC wielu modeli nałożone na jeden wykres — `roc` z EvaluationDto to
// dwie równoległe tablice `{fpr, tpr}` (nie tablica punktów), więc zip-ujemy je tu do punktów,
// które Recharts potrafi narysować per seria. Kolor serii po `kind` modelu (theme.ts); bez
// `kind` — paleta zapasowa z tych samych tokenów.
import type { ReactNode } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../ui/Card";
import { chartTheme } from "../../chartTheme";
import { cssVar, modelColor } from "../../theme";

export type RocSeries = { name: string; auc: number | null; roc: { fpr: number[]; tpr: number[] }; kind?: string | undefined };

export function rocColor(kind: string | undefined, index: number): string {
  if (kind) return modelColor(kind);
  const palette = [cssVar("--accent"), cssVar("--model-baseline-v2"), cssVar("--warn"), cssVar("--info"), cssVar("--danger")];
  return palette[index % palette.length]!;
}

function toPoints(roc: { fpr: number[]; tpr: number[] }): { fpr: number; tpr: number }[] {
  return roc.fpr.map((fpr, i) => ({ fpr, tpr: roc.tpr[i] ?? 0 }));
}

// Wzory kreski per pozycja w obrębie tego samego `kind` (kolor po kind — więc dwa modele tego
// samego rodzaju mają ten sam kolor; kreska je odróżnia). Serie bez `kind` (paleta zapasowa,
// każda ma własny kolor) dostają zawsze indeks 0 (linia ciągła).
const DASH_BY_INDEX = ["", "4 2", "1 3"];

export type RocChartProps = { series: RocSeries[]; title?: string; meta?: ReactNode };

export function RocChart({ series, title = "Krzywe ROC", meta = "FPR × TPR · AUC w legendzie" }: RocChartProps) {
  const t = chartTheme();
  const kindIndex = new Map<string, number>();
  return (
    <Card title={title} meta={meta} className="chart-card">
      <ResponsiveContainer width="100%" height={380}>
        <LineChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
          <CartesianGrid {...t.grid} />
          <XAxis
            type="number"
            dataKey="fpr"
            domain={[0, 1]}
            tick={t.tick}
            axisLine={t.axisLine}
            tickLine={t.tickLine}
            label={{ value: "FPR", position: "insideBottom", offset: -10, fill: t.tick.fill, fontSize: 11 }}
          />
          <YAxis
            type="number"
            dataKey="tpr"
            domain={[0, 1]}
            tick={t.tick}
            axisLine={false}
            tickLine={t.tickLine}
            label={{ value: "TPR", angle: -90, position: "insideLeft", fill: t.tick.fill, fontSize: 11 }}
          />
          <Tooltip {...t.tooltip} formatter={(v) => (typeof v === "number" ? v.toFixed(3) : v)} />
          <Legend {...t.legend} />
          <ReferenceLine
            segment={[
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ]}
            stroke={cssVar("--border")}
            strokeDasharray="4 4"
          />
          {series.map((s, i) => {
            const group = s.kind ?? `_${i}`;
            const ki = kindIndex.get(group) ?? 0;
            kindIndex.set(group, ki + 1);
            return (
              <Line
                key={s.name}
                data={toPoints(s.roc)}
                dataKey="tpr"
                name={s.auc != null ? `${s.name} (AUC ${s.auc.toFixed(3)})` : s.name}
                stroke={rocColor(s.kind, i)}
                strokeDasharray={DASH_BY_INDEX[ki % DASH_BY_INDEX.length] ?? ""}
                strokeWidth={1.75}
                dot={false}
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
