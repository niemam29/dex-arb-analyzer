import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Card } from "./Card";
import { Stat } from "./Stat";
import { Badge } from "./Badge";
import { Bar } from "./Bar";
import { Button } from "./Button";

it("Card renderuje tytuł jako nagłówek, meta i akcje; bez tytułu nie ma nagłówka", () => {
  const { container, rerender } = render(
    <Card title="Okazje" meta="WETH/USDC · maj 2021" actions={<button>Akcja</button>}>
      treść
    </Card>,
  );
  expect(screen.getByRole("heading", { name: "Okazje" })).toBeInTheDocument();
  expect(screen.getByText("WETH/USDC · maj 2021")).toHaveClass("card-meta");
  expect(screen.getByRole("button", { name: "Akcja" })).toBeInTheDocument();
  expect(container.firstElementChild).toHaveClass("card");
  expect(container.firstElementChild).not.toHaveClass("card--flush");

  rerender(<Card padded={false}>tabela</Card>);
  expect(container.firstElementChild).toHaveClass("card--flush");
  expect(container.querySelector(".card-head")).toBeNull();
});

it("Stat pokazuje etykietę, wartość, hint i klasę tonu", () => {
  const { container } = render(<Stat label="Okazje" value="655" hint="na tej stronie" tone="ok" />);
  expect(screen.getByText("Okazje")).toHaveClass("stat-label");
  expect(screen.getByText("655")).toHaveClass("stat-value");
  expect(screen.getByText("na tej stronie")).toHaveClass("stat-hint");
  expect(container.firstElementChild).toHaveClass("stat", "stat--ok");
});

it("Stat size='mini' dodaje klasę stat--mini", () => {
  const { container } = render(<Stat label="Precyzja" value="0,75" size="mini" />);
  expect(container.firstElementChild).toHaveClass("stat", "stat--mini");
});

it("Badge mapuje tone na klasę badge--<tone>", () => {
  render(
    <>
      <Badge tone="ok">atomowo</Badge>
      <Badge tone="warn">częściowo</Badge>
      <Badge tone="danger">utrzymała się</Badge>
      <Badge tone="info">running</Badge>
      <Badge tone="muted">wygasła</Badge>
      <Badge tone="accent">multi</Badge>
    </>,
  );
  expect(screen.getByText("atomowo")).toHaveClass("badge", "badge--ok");
  expect(screen.getByText("częściowo")).toHaveClass("badge--warn");
  expect(screen.getByText("utrzymała się")).toHaveClass("badge--danger");
  expect(screen.getByText("running")).toHaveClass("badge--info");
  expect(screen.getByText("wygasła")).toHaveClass("badge--muted");
  expect(screen.getByText("multi")).toHaveClass("badge--accent");
});

it("Bar to progressbar 0–1 z wypełnieniem w %, wartości spoza zakresu są przycinane", () => {
  const { rerender } = render(<Bar value={0.75} tone="ok" label="pokrycie" />);
  const bar = screen.getByRole("progressbar", { name: "pokrycie" });
  expect(bar).toHaveAttribute("aria-valuenow", "0.75");
  expect(bar).toHaveClass("bar", "bar--ok");
  expect(bar.querySelector(".fill")).toHaveStyle({ width: "75%" });
  rerender(<Bar value={1.7} />);
  expect(screen.getByRole("progressbar").querySelector(".fill")).toHaveStyle({ width: "100%" });
  expect(screen.getByRole("progressbar")).toHaveClass("bar--accent");
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  rerender(<Bar value={-0.3} />);
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
});

it("Button: wariant i rozmiar jako klasy, type=button domyślnie, onClick i disabled działają", async () => {
  const onClick = vi.fn();
  render(
    <>
      <Button onClick={onClick}>Pobierz</Button>
      <Button variant="primary" size="sm" disabled>
        Trenuj
      </Button>
    </>,
  );
  const b = screen.getByRole("button", { name: "Pobierz" });
  expect(b).toHaveClass("btn", "btn--secondary", "btn--md");
  expect(b).toHaveAttribute("type", "button");
  await userEvent.click(b);
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Trenuj" })).toHaveClass("btn--primary", "btn--sm");
  expect(screen.getByRole("button", { name: "Trenuj" })).toBeDisabled();
});
