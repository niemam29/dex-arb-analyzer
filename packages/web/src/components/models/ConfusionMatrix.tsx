// Macierz pomyłek + P/R/F1 dla jednej ewaluacji modelu — `confusion` ma
// kształt `ConfusionMatrixDto` (@dex-arb/shared): pozytyw modelu = score >= 50 (próg z
// EvaluationDto liczonego w API), pozytyw etykiety = `profitable_consumed` zweryfikowanej okazji.
// TP/TN w --ok-soft, FP/FN w --danger-soft; metryki jako trzy miniaturowe Stat.
import type { ConfusionMatrixDto } from "@dex-arb/shared";
import { Stat } from "../ui/Stat";

const fmt = (v: number) => v.toLocaleString("pl-PL", { maximumFractionDigits: 3 });

export type ConfusionMatrixProps = {
  confusion: ConfusionMatrixDto;
  precision: number;
  recall: number;
  f1: number;
};

export function ConfusionMatrix({ confusion: c, precision, recall, f1 }: ConfusionMatrixProps) {
  return (
    <div className="confusion">
      <table className="table confusion-table">
        <caption>Macierz pomyłek</caption>
        <thead>
          <tr>
            <th></th>
            <th className="num">Skonsumowana z zyskiem</th>
            <th className="num">Nie</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Model: pozytyw</th>
            <td data-testid="tp" className="cell cell--ok num">
              {c.tp}
            </td>
            <td data-testid="fp" className="cell cell--danger num">
              {c.fp}
            </td>
          </tr>
          <tr>
            <th scope="row">Model: negatyw</th>
            <td data-testid="fn" className="cell cell--danger num">
              {c.fn}
            </td>
            <td data-testid="tn" className="cell cell--ok num">
              {c.tn}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="stat-row">
        <Stat label="Precyzja" value={fmt(precision)} size="mini" />
        <Stat label="Czułość" value={fmt(recall)} size="mini" />
        <Stat label="F1" value={fmt(f1)} size="mini" />
      </div>
    </div>
  );
}
