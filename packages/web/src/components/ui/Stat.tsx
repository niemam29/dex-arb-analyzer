import type { ReactNode } from "react";

// Kafelek KPI: etykieta wersalikami, wartość 21/650 (tabular-nums), opcjonalny hint (np. „na tej
// stronie", gdy liczba jest przybliżeniem z pobranej listy).

export type StatTone = "ok" | "warn" | "danger" | "muted" | "accent";
export type StatSize = "md" | "mini";

export type StatProps = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
  size?: StatSize;
};

export function Stat({ label, value, hint, tone, size }: StatProps) {
  const cls = ["stat", tone ? `stat--${tone}` : "", size === "mini" ? "stat--mini" : ""].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint != null && <span className="stat-hint">{hint}</span>}
    </div>
  );
}
