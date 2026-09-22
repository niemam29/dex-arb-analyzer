// Formularz kalibracji baseline v2 — ciało zgodne z `CalibrateBaselineV2Request` (@dex-arb/shared,
// dto/models.ts): tylko okna kalibracyjne/testowe i opcjonalna nazwa (kalibracja to
// deterministyczna siatka, bez hiperparametrów uczenia — w przeciwieństwie do `TrainForm`).
import { useState } from "react";
import type { CalibrateBaselineV2Request } from "@dex-arb/shared";
import { Button } from "../ui/Button";
import { WindowPills } from "../ui/WindowPills";

export type CalibrateBaselineV2FormProps = {
  windows: { id: number; name: string }[];
  onSubmit: (req: CalibrateBaselineV2Request) => void;
  pending: boolean;
};

export function CalibrateBaselineV2Form({ windows, onSubmit, pending }: CalibrateBaselineV2FormProps) {
  const [train, setTrain] = useState<number[]>([]);
  const [test, setTest] = useState<number[]>([]);
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
        onSubmit({ train_windows: train, test_windows: test, name: name.trim() ? name.trim() : undefined });
      }}
    >
      <WindowPills legend="Okna kalibracyjne" prefix="kalibracja" windows={windows} selected={train} onToggle={(id) => toggle(train, setTrain, test, setTest, id)} />
      <WindowPills legend="Okna testowe (holdout)" prefix="holdout" windows={windows} selected={test} onToggle={(id) => toggle(test, setTest, train, setTrain, id)} />
      <div className="param-grid">
        <label className="field field--wide">
          <span className="label">Nazwa (opcjonalnie)</span>
          <input type="text" aria-label="Nazwa baseline v2 (opcjonalnie)" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <div className="form-actions">
        <Button type="submit" variant="primary" aria-label="Kalibruj baseline v2" disabled={pending || train.length === 0}>
          {pending ? "Trwa…" : "Kalibruj baseline v2"}
        </Button>
      </div>
    </form>
  );
}
