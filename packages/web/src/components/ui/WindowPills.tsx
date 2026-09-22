// Okna jako klikane pigułki (checkbox ukryty `.sr-only`, etykieta `<prefix>: <okno>` — bez zmian
// dla testów/a11y). Wspólne dla TrainForm (trening ANFIS) i CalibrateBaselineV2Form (kalibracja
// baseline v2) — przeniesione z components/models/TrainForm.tsx do components/ui,
// bo oba formularze go używały.

export type WindowPillsProps = {
  legend: string;
  prefix: string;
  windows: { id: number; name: string }[];
  selected: number[];
  onToggle: (id: number) => void;
};

export function WindowPills({ legend, prefix, windows, selected, onToggle }: WindowPillsProps) {
  return (
    <fieldset className="pill-group">
      <legend className="label">{legend}</legend>
      <div className="pills">
        {windows.map((w) => {
          const on = selected.includes(w.id);
          return (
            <label key={w.id} className={on ? "pill pill--on" : "pill"}>
              <input type="checkbox" className="sr-only" aria-label={`${prefix}: ${w.name}`} checked={on} onChange={() => onToggle(w.id)} />
              {w.name}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
