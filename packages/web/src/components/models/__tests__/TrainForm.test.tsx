import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TrainForm } from "../TrainForm";

const windows = [
  { id: 1, name: "maj 2021" },
  { id: 2, name: "listopad 2022" },
];

describe("TrainForm", () => {
  it("wysyła wybrane okna treningowe/testowe, seed, epochs i lr (kontrakt TrainRequest snake_case)", async () => {
    const onSubmit = vi.fn();
    render(<TrainForm windows={windows} onSubmit={onSubmit} pending={false} />);
    await userEvent.click(screen.getByLabelText("trening: maj 2021"));
    await userEvent.click(screen.getByLabelText("test: listopad 2022"));
    await userEvent.clear(screen.getByLabelText("Seed"));
    await userEvent.type(screen.getByLabelText("Seed"), "7");
    await userEvent.click(screen.getByRole("button", { name: "Trenuj ANFIS" }));
    expect(onSubmit).toHaveBeenCalledWith({
      train_windows: [1],
      test_windows: [2],
      seed: 7,
      epochs: 200,
      lr: 0.01,
      name: undefined,
    });
  });

  it("zaznaczenie okna w jednym zbiorze usuwa je z drugiego (zbiory rozłączne)", async () => {
    const onSubmit = vi.fn();
    render(<TrainForm windows={windows} onSubmit={onSubmit} pending={false} />);
    await userEvent.click(screen.getByLabelText("trening: maj 2021"));
    await userEvent.click(screen.getByLabelText("test: maj 2021"));
    expect(screen.getByLabelText("trening: maj 2021")).not.toBeChecked();
    expect(screen.getByLabelText("test: maj 2021")).toBeChecked();
    await userEvent.click(screen.getByLabelText("trening: listopad 2022"));
    await userEvent.click(screen.getByLabelText("trening: maj 2021"));
    expect(screen.getByLabelText("test: maj 2021")).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Trenuj ANFIS" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ train_windows: [1, 2], test_windows: [] }));
  });

  it("blokuje przycisk bez okna treningowego", () => {
    render(<TrainForm windows={windows} onSubmit={() => {}} pending={false} />);
    expect(screen.getByRole("button", { name: "Trenuj ANFIS" })).toBeDisabled();
  });

  it("blokuje przycisk, gdy pending, nawet z wybranym oknem", async () => {
    render(<TrainForm windows={windows} onSubmit={() => {}} pending={true} />);
    await userEvent.click(screen.getByLabelText("trening: maj 2021"));
    expect(screen.getByRole("button", { name: "Trenuj ANFIS" })).toBeDisabled();
  });

  it("przekazuje przycięte pole 'Nazwa' albo undefined, gdy puste", async () => {
    const onSubmit = vi.fn();
    render(<TrainForm windows={windows} onSubmit={onSubmit} pending={false} />);
    await userEvent.click(screen.getByLabelText("trening: maj 2021"));
    await userEvent.type(screen.getByLabelText("Nazwa (opcjonalnie)"), "  anfis-eksperyment  ");
    await userEvent.click(screen.getByRole("button", { name: "Trenuj ANFIS" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: "anfis-eksperyment" }));
  });

  it("okna są pigułkami: zaznaczone dostają klasę pill--on; pending pokazuje „Trwa…” z zachowaną nazwą przycisku", async () => {
    const { rerender } = render(<TrainForm windows={windows} onSubmit={() => {}} pending={false} />);
    const box = screen.getByLabelText("trening: maj 2021");
    expect(box).toHaveClass("sr-only");
    expect(box.closest("label")).toHaveClass("pill");
    expect(box.closest("label")).not.toHaveClass("pill--on");
    await userEvent.click(box);
    expect(box.closest("label")).toHaveClass("pill--on");
    expect(screen.getByRole("button", { name: "Trenuj ANFIS" })).toHaveClass("btn--primary");
    rerender(<TrainForm windows={windows} onSubmit={() => {}} pending={true} />);
    const btn = screen.getByRole("button", { name: "Trenuj ANFIS" });
    expect(btn).toHaveTextContent("Trwa…");
    expect(btn).toBeDisabled();
  });
});
