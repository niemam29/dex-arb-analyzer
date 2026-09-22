import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfusionMatrix } from "../ConfusionMatrix";

describe("ConfusionMatrix", () => {
  it("pokazuje 4 komórki (TP/TN zielone, FP/FN czerwone) i metryki jako mini-KPI", () => {
    render(<ConfusionMatrix confusion={{ tp: 3, fp: 1, fn: 1, tn: 3 }} precision={0.75} recall={0.75} f1={0.5} />);
    expect(screen.getByTestId("tp").textContent).toBe("3");
    expect(screen.getByTestId("fp").textContent).toBe("1");
    expect(screen.getByTestId("fn").textContent).toBe("1");
    expect(screen.getByTestId("tn").textContent).toBe("3");
    expect(screen.getByTestId("tp")).toHaveClass("cell--ok");
    expect(screen.getByTestId("tn")).toHaveClass("cell--ok");
    expect(screen.getByTestId("fp")).toHaveClass("cell--danger");
    expect(screen.getByTestId("fn")).toHaveClass("cell--danger");
    expect(screen.getByText("F1").parentElement?.textContent).toMatch(/0[,.]5/);
    expect(screen.getByText("Precyzja").parentElement?.textContent).toMatch(/0[,.]75/);
    expect(document.querySelectorAll(".stat-row .stat--mini")).toHaveLength(3);
  });
});
