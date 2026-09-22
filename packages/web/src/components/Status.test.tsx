import { it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Loading, ErrorMessage, errorMessage } from "./Status";
import { ApiError } from "../api/client";

it("Loading pokazuje komunikat ładowania", () => {
  render(<Loading />);
  expect(screen.getByText("Ładowanie…")).toBeInTheDocument();
});

it("ErrorMessage z ApiError pokazuje jej .message", () => {
  render(<ErrorMessage error={new ApiError(404, "Para o id=1 nie istnieje")} />);
  expect(screen.getByText("Błąd: Para o id=1 nie istnieje")).toBeInTheDocument();
});

it("ErrorMessage z innym błędem pokazuje String(err)", () => {
  render(<ErrorMessage error={new Error("sieć padła")} />);
  expect(screen.getByText("Błąd: Error: sieć padła")).toBeInTheDocument();
});

it("errorMessage: ApiError -> .message, inne -> String(err)", () => {
  expect(errorMessage(new ApiError(500, "coś padło"))).toBe("coś padło");
  expect(errorMessage(new Error("x"))).toBe("Error: x");
});

it("Loading/ErrorMessage mają klasy statusu i role status/alert", () => {
  render(<Loading />);
  expect(screen.getByRole("status")).toHaveClass("status", "status--loading");
  render(<ErrorMessage error={new Error("x")} />);
  expect(screen.getByRole("alert")).toHaveClass("status", "status--error");
});
