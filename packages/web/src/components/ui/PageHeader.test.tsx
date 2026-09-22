import { it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";

it("PageHeader: okruszki, tytuł jako nagłówek h2, kontekst i siatka KPI ze Stat", () => {
  render(
    <PageHeader
      crumbs={["Okazje", "WETH/USDC", "maj 2021"]}
      title="Okazje"
      context="bloki 12430000–12500000"
      stats={[
        { label: "Bloki", value: "70 001" },
        { label: "Okazje", value: "655", hint: "na tej stronie" },
      ]}
    />,
  );
  const crumbs = screen.getByRole("navigation", { name: "Okruszki" });
  expect(crumbs.textContent).toBe("Okazje / WETH/USDC / maj 2021");
  expect(screen.getByRole("heading", { level: 2, name: "Okazje" })).toBeInTheDocument();
  expect(screen.getByText("bloki 12430000–12500000")).toHaveClass("page-context");
  expect(screen.getByText("Bloki")).toHaveClass("stat-label");
  expect(screen.getByText("655")).toHaveClass("stat-value");
  expect(screen.getByText("na tej stronie")).toHaveClass("stat-hint");
  expect(document.querySelectorAll(".kpi-grid .stat")).toHaveLength(2);
});

it("PageHeader bez stats nie renderuje siatki KPI", () => {
  render(<PageHeader crumbs={["Dane"]} title="Dane" />);
  expect(document.querySelector(".kpi-grid")).toBeNull();
});

it("EmptyState: tytuł, hint i akcja", () => {
  render(<EmptyState title="Brak zadań" hint="Zleć zadanie w tabeli pokrycia." action={<button>Pobierz</button>} />);
  expect(screen.getByText("Brak zadań")).toHaveClass("empty-title");
  expect(screen.getByText("Zleć zadanie w tabeli pokrycia.")).toHaveClass("empty-hint");
  expect(screen.getByRole("button", { name: "Pobierz" })).toBeInTheDocument();
});
