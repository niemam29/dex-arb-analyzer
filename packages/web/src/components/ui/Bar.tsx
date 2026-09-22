// Pasek 0–1 (pokrycie, aktywacje reguł Mamdaniego, postęp zadań) — rola progressbar; `.fill`
// zostaje jako selektor, bo testy RuleActivationBars sprawdzają jego szerokość.

export type BarTone = "accent" | "ok" | "warn" | "danger";

export type BarProps = { value: number; tone?: BarTone; label?: string };

export function Bar({ value, tone = "accent", label }: BarProps) {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return (
    <div
      role="progressbar"
      className={`bar bar--${tone}`}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={clamped}
      aria-label={label}
    >
      <div className="fill" style={{ width: `${Math.round(clamped * 100)}%` }} />
    </div>
  );
}
