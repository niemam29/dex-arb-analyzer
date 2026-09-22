// packages/web/src/components/models/__tests__/charts.test.tsx
// Wykresy modeli w jsdom: Recharts nie rysuje bez layoutu — sprawdzamy kartę i legendę-tekst.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RocChart, rocColor } from "../RocChart";
import { ScoreHistogram } from "../ScoreHistogram";

describe("RocChart", () => {
  it("renderuje kartę z tytułem i kontekstem; kolor serii z kind modelu albo z palety", () => {
    render(<RocChart series={[{ name: "Mamdani: m1", auc: 0.8, roc: { fpr: [0, 1], tpr: [0, 1] }, kind: "mamdani" }]} />);
    expect(screen.getByRole("heading", { name: "Krzywe ROC" })).toBeInTheDocument();
    expect(screen.getByText("FPR × TPR · AUC w legendzie")).toHaveClass("card-meta");
    expect(rocColor("mamdani", 0)).toBe("#d97706");
    expect(rocColor(undefined, 0)).toBe("#4f46e5");
    expect(rocColor(undefined, 1)).toBe("#0d9488");
  });
});

describe("ScoreHistogram", () => {
  it("renderuje kartę z tytułem z props i domyślnym kontekstem o skali pierwiastkowej", () => {
    render(<ScoreHistogram histogram={{ edges: [0, 50, 100], positive: [1, 3], negative: [3, 1] }} title="Rozkład score" />);
    expect(screen.getByRole("heading", { name: "Rozkład score" })).toBeInTheDocument();
    expect(screen.getByText(/skali pierwiastkowej/)).toHaveClass("card-meta");
  });
});
