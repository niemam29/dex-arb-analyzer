// Mini-wykres spreadu z historii ostatniej godziny (spec §7): LineChart 120 px bez osi,
// ReferenceLine na progu SPREAD_THRESHOLD_PCT, kolory/tooltip z chartTheme. Czysto prezentacyjny
// (eksport w ds.ts).
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { chartTheme } from "../../chartTheme";
import { cssVar } from "../../theme";
import { fmtPct } from "../../format";

export type SparklineChartProps = {
  points: { at: string; spread_pct: number }[];
  thresholdPct: number;
  height?: number;
};

const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function SparklineChart({ points, thresholdPct, height = 120 }: SparklineChartProps) {
  if (points.length === 0) {
    return (
      <p className="sparkline sparkline--empty muted" style={{ height }}>
        brak historii
      </p>
    );
  }
  const t = chartTheme();
  const rows = points.map((p) => ({ at: p.at, spread: p.spread_pct }));
  // Skala Y liczona wyłącznie z danych (nie z progu) — para z niskim spreadem dostaje czytelną
  // skalę zamiast spłaszczonej linii przy dnie wykresu; próg poza skalą jest po prostu ukryty
  // (ifOverflow="hidden") i zaznaczony w opisie, zamiast rozciągać oś do jego wysokości.
  const maxSpread = Math.max(...rows.map((r) => r.spread), 0);
  const maxY = Math.max(maxSpread * 1.25, 1e-3);
  const outOfScale = thresholdPct > maxY;
  const label = `Spread z ostatniej godziny, próg ${fmtPct(thresholdPct)}${outOfScale ? " · poza skalą" : ""}`;
  return (
    <div className="sparkline" role="img" aria-label={label} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={[0, maxY]} />
          <Tooltip {...t.tooltip} labelFormatter={(v) => timeLabel(String(v))} formatter={(v) => [fmtPct(Number(v)), "spread"]} />
          <ReferenceLine y={thresholdPct} stroke={cssVar("--warn")} strokeDasharray="3 3" ifOverflow="hidden" />
          <Line type="monotone" dataKey="spread" stroke={cssVar("--accent")} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
