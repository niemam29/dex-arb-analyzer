// Formularz treningu ANFIS — buduje ciało zgodne z `TrainRequest` (@dex-arb/shared,
// dto/models.ts): kontrakt HTTP, pola snake_case (`train_windows`/`test_windows`), reszta
// opcjonalna. Kontrakt zadania w kolejce to osobny `trainParams` w `shared/src/jobs.ts` — trasa
// API tłumaczy jedno na drugie i uzupełnia domyślne przed utworzeniem joba. Okna jako klikane
// pigułki — `WindowPills` w components/ui (przeniesiony stąd, współdzielony z
// CalibrateBaselineV2Form).
import { useState } from "react";
import type { TrainRequest } from "@dex-arb/shared";
import { Button } from "../ui/Button";
import { WindowPills } from "../ui/WindowPills";

export type TrainFormProps = {
  windows: { id: number; name: string }[];
  onSubmit: (req: TrainRequest) => void;
  pending: boolean;
};

export function TrainForm({ windows, onSubmit, pending }: TrainFormProps) {
  const [train, setTrain] = useState<number[]>([]);
  const [test, setTest] = useState<number[]>([]);
  const [seed, setSeed] = useState(42);
  const [epochs, setEpochs] = useState(200);
  const [lr, setLr] = useState(0.01);
  const [name, setName] = useState("");

  // Zbiory rozłączne (API odpowiada 400 przy części wspólnej): zaznaczenie okna w jednym zbiorze
  // usuwa je z drugiego.
  const without = (arr: number[], id: number) => arr.filter((x) => x !== id);
  const toggle = (arr: number[], set: (v: number[]) => void, other: number[], setOther: (v: number[]) => void, id: number) => {
    if (arr.includes(id)) return set(without(arr, id));
    set([...arr, id].sort((a, b) => a - b));
    if (other.includes(id)) setOther(without(other, id));
  };

  return (
    <form
      className="model-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          train_windows: train,
          test_windows: test,
          seed,
          epochs,
          lr,
          name: name.trim() ? name.trim() : undefined,
        });
      }}
    >
      <WindowPills legend="Okna treningowe" prefix="trening" windows={windows} selected={train} onToggle={(id) => toggle(train, setTrain, test, setTest, id)} />
      <WindowPills legend="Okna testowe" prefix="test" windows={windows} selected={test} onToggle={(id) => toggle(test, setTest, train, setTrain, id)} />
      <div className="param-grid">
        <label className="field">
          <span className="label">Seed</span>
          <input type="number" aria-label="Seed" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
        </label>
        <label className="field">
          <span className="label">Epoki</span>
          <input type="number" min={1} max={2000} aria-label="Epoki" value={epochs} onChange={(e) => setEpochs(Number(e.target.value))} />
        </label>
        <label className="field">
          <span className="label">Krok uczenia (lr)</span>
          <input type="number" step="any" min={0.0001} max={1} aria-label="Krok uczenia (lr)" value={lr} onChange={(e) => setLr(Number(e.target.value))} />
        </label>
        <label className="field field--wide">
          <span className="label">Nazwa (opcjonalnie)</span>
          <input type="text" aria-label="Nazwa (opcjonalnie)" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <div className="form-actions">
        <Button type="submit" variant="primary" aria-label="Trenuj ANFIS" disabled={pending || train.length === 0}>
          {pending ? "Trwa…" : "Trenuj ANFIS"}
        </Button>
        {pending && <span className="muted">zadanie w kolejce — postęp niżej</span>}
      </div>
    </form>
  );
}
