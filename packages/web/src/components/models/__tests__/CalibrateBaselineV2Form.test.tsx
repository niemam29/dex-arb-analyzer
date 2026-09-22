import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CalibrateBaselineV2Form } from "../CalibrateBaselineV2Form";

const windows = [
  { id: 1, name: "maj 2021" },
  { id: 2, name: "listopad 2022" },
];

describe("CalibrateBaselineV2Form", () => {
  it("wysyła okna kalibracyjne/holdout i nazwę (kontrakt CalibrateBaselineV2Request)", async () => {
    const onSubmit = vi.fn();
    render(<CalibrateBaselineV2Form windows={windows} onSubmit={onSubmit} pending={false} />);
    await userEvent.click(screen.getByLabelText("kalibracja: maj 2021"));
    await userEvent.click(screen.getByLabelText("holdout: listopad 2022"));
    await userEvent.type(screen.getByLabelText("Nazwa baseline v2 (opcjonalnie)"), " bv2 ");
    await userEvent.click(screen.getByRole("button", { name: "Kalibruj baseline v2" }));
    expect(onSubmit).toHaveBeenCalledWith({ train_windows: [1], test_windows: [2], name: "bv2" });
  });

  it("zaznaczenie okna w jednym zbiorze usuwa je z drugiego (zbiory rozłączne)", async () => {
    const onSubmit = vi.fn();
    render(<CalibrateBaselineV2Form windows={windows} onSubmit={onSubmit} pending={false} />);
    await userEvent.click(screen.getByLabelText("kalibracja: maj 2021"));
    await userEvent.click(screen.getByLabelText("holdout: maj 2021"));
    expect(screen.getByLabelText("kalibracja: maj 2021")).not.toBeChecked();
    expect(screen.getByLabelText("holdout: maj 2021")).toBeChecked();
    await userEvent.click(screen.getByLabelText("kalibracja: maj 2021"));
    expect(screen.getByLabelText("holdout: maj 2021")).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Kalibruj baseline v2" }));
    expect(onSubmit).toHaveBeenCalledWith({ train_windows: [1], test_windows: [], name: undefined });
  });

  it("blokuje przycisk bez okna kalibracyjnego", () => {
    render(<CalibrateBaselineV2Form windows={windows} onSubmit={() => {}} pending={false} />);
    expect(screen.getByRole("button", { name: "Kalibruj baseline v2" })).toBeDisabled();
  });

  it("okna są pigułkami; pending pokazuje „Trwa…” z zachowaną nazwą przycisku", async () => {
    const { rerender } = render(<CalibrateBaselineV2Form windows={windows} onSubmit={() => {}} pending={false} />);
    const box = screen.getByLabelText("holdout: listopad 2022");
    await userEvent.click(box);
    expect(box.closest("label")).toHaveClass("pill", "pill--on");
    rerender(<CalibrateBaselineV2Form windows={windows} onSubmit={() => {}} pending={true} />);
    expect(screen.getByRole("button", { name: "Kalibruj baseline v2" })).toHaveTextContent("Trwa…");
  });
});
