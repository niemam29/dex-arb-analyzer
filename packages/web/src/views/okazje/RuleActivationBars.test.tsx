import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RuleActivationBars, RULE_DESCRIPTIONS } from "./RuleActivationBars";

describe("RuleActivationBars", () => {
  it("renderuje jeden pasek na regułę, szerokość proporcjonalna do siły", () => {
    render(
      <RuleActivationBars
        activations={[
          { id: "R1", strength: 0 },
          { id: "R5", strength: 0.75 },
        ]}
      />,
    );
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(2);
    expect(bars[1]).toHaveAttribute("aria-valuenow", "0.75");
    expect(bars[1]!.querySelector(".fill")).toHaveStyle({ width: "75%" });
    expect(screen.getByText("R5")).toBeInTheDocument();
  });

  it("renderuje wszystkie 16 reguł z opisem jako tooltip", () => {
    const activations = Array.from({ length: 16 }, (_, i) => ({ id: `R${i + 1}`, strength: 0.1 * i }));
    render(<RuleActivationBars activations={activations} />);
    expect(screen.getAllByRole("progressbar")).toHaveLength(16);
    expect(screen.getByText("R1").closest("li")).toHaveAttribute("title", RULE_DESCRIPTIONS.R1);
    expect(screen.getByText("R16").closest("li")).toHaveAttribute("title", RULE_DESCRIPTIONS.R16);
  });

  it("pasek jest prymitywem Bar w tonie akcentu, wartość z 2 miejscami", () => {
    render(<RuleActivationBars activations={[{ id: "R7", strength: 0.6 }]} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveClass("bar", "bar--accent");
    expect(screen.getByText("0.60")).toHaveClass("rule-val");
  });
});
