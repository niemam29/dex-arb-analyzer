import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BaselineV2Params } from "../BaselineV2Params";

describe("BaselineV2Params", () => {
  it("pokazuje wszystkie parametry, w tym arbGasRef i optTradeQuantiles, brakujące jako myślnik", () => {
    render(
      <BaselineV2Params
        params={{ gasUnits: 150000, gasPriceFactor: 0.5, threshold: 0.42, weightOptTrade: 0, scale: 12.5, optTradeQuantiles: [0.1, 0.5, 0.9], arbGasRef: 220000 }}
      />,
    );
    const dl = screen.getByLabelText("Parametry baseline v2");
    expect(dl).toHaveClass("detail", "baseline-v2-params");
    expect(screen.getByText("Gaz [jedn.]").nextElementSibling).toHaveTextContent("150 000");
    expect(screen.getByText("Gaz referencyjny arb. [jedn.]").nextElementSibling).toHaveTextContent("220 000");
    expect(screen.getByText("Kwantyle optTrade").nextElementSibling).toHaveTextContent("0,1 / 0,5 / 0,9");
    expect(screen.getByText("Mnożnik ceny gazu").nextElementSibling).toHaveTextContent("0,5");
  });

  it("brak parametru -> myślnik", () => {
    render(<BaselineV2Params params={{}} />);
    expect(screen.getByText("Próg (v)").nextElementSibling).toHaveTextContent("—");
    expect(screen.getByText("Kwantyle optTrade").nextElementSibling).toHaveTextContent("—");
  });
});
