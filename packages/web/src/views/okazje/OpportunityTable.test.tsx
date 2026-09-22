import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { OpportunityListItem } from "@dex-arb/shared";
import { OpportunityTable, statusLabel, statusShortLabel, fmtUsd, fmtPct, directionLabel, directionShort, STATUS_TONE } from "./OpportunityTable";

const item = (o: Partial<OpportunityListItem> = {}): OpportunityListItem => ({
  id: 1,
  block: 12430000,
  spread_pct: 1.234,
  direction: "a_to_b",
  est_profit_usd: 12.5,
  verification: null,
  scores: {},
  ...o,
});

describe("OpportunityTable", () => {
  it("renderuje statusy jako Badge z tonem, multi jako drugą pigułkę, sformatowane liczby", () => {
    render(
      <OpportunityTable
        items={[
          item({
            id: 1,
            verification: {
              status: "consumed_atomic",
              route: "two_pool",
              consumer_tx_hash: "0xabc",
              realized_profit_usd: 20.5,
              gas_used: "200000",
              gas_cost_usd: 5,
              blocks_to_consumption: 1,
              profitable_consumed: true,
              verified_at: "2021-05-14T00:00:00Z",
            },
          }),
          item({ id: 2 }),
          item({
            id: 3,
            verification: {
              status: "consumed_atomic",
              route: "multi",
              consumer_tx_hash: "0xdef",
              realized_profit_usd: null,
              gas_used: "300000",
              gas_cost_usd: 7,
              blocks_to_consumption: 0,
              profitable_consumed: false,
              verified_at: "2021-05-14T00:00:00Z",
            },
          }),
        ]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    const atomic = screen.getAllByText("atomowo");
    expect(atomic).toHaveLength(2);
    expect(atomic[0]).toHaveClass("badge", "badge--ok");
    expect(atomic[0]).toHaveAttribute("title", "skonsumowana (atomowo)");
    expect(screen.queryByText("skonsumowana (atomowo)")).not.toBeInTheDocument();
    expect(screen.getByText("niezweryfikowana")).toHaveClass("badge--muted");
    expect(screen.getByText("multi")).toHaveClass("badge--muted");
    expect(screen.getAllByText("1,234 %")).toHaveLength(3);
    expect(screen.getByText("✓")).toBeInTheDocument();
    // route='multi': zysk nieznany -> "?" z tytułem, nie "✗"
    const unknown = screen.getByText("?");
    expect(unknown).toHaveAttribute("title", "trasa wielopulowa — zysk nieznany");
    expect(screen.queryByText("✗")).not.toBeInTheDocument();
    // kolumna Blok jako .key, liczby jako .num
    expect(screen.getAllByText("12430000")[0]).toHaveClass("key");
    expect(screen.getAllByText("1,234 %")[0]).toHaveClass("num");
  });

  it("kierunek renderuje krótką formę A→B w komórce, pełny opis w title=", () => {
    render(<OpportunityTable items={[item({ id: 1, direction: "a_to_b" })]} selectedId={null} onSelect={() => {}} />);
    const cell = screen.getByText("A→B");
    expect(cell).toHaveAttribute("title", "A→B (Uniswap→Sushi)");
  });

  it("nagłówek 'Bloki' ma pełny opis 'Bloki do konsumpcji' w title=", () => {
    render(<OpportunityTable items={[item({})]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByRole("columnheader", { name: "Bloki" })).toHaveAttribute("title", "Bloki do konsumpcji");
  });

  it("bez osobnej kolumny 'Opłacalna' — status opłacalności jest w komórce Status", () => {
    render(<OpportunityTable items={[item({})]} selectedId={null} onSelect={() => {}} />);
    expect(screen.queryByRole("columnheader", { name: "Opłacalna" })).not.toBeInTheDocument();
  });

  it("STATUS_TONE: atomowo=ok, częściowo=warn, wygasła=muted, utrzymała się=danger, niezweryfikowana=muted", () => {
    expect(STATUS_TONE).toEqual({
      consumed_atomic: "ok",
      consumed_partial: "warn",
      decayed: "muted",
      persisted: "danger",
      unverified: "muted",
    });
  });

  it("klik w wiersz wywołuje onSelect z id i oznacza wiersz jako wybrany", () => {
    const onSelect = vi.fn();
    render(<OpportunityTable items={[item({ id: 1 })]} selectedId={1} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("12430000"));
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(screen.getByRole("row", { selected: true })).toBeInTheDocument();
  });

  it("wiersz jest fokusowalny i wybieralny klawiaturą (Enter/Spacja)", () => {
    const onSelect = vi.fn();
    render(<OpportunityTable items={[item({ id: 1 })]} selectedId={null} onSelect={onSelect} />);
    const row = screen.getByRole("row", { name: /12430000/ });
    expect(row).toHaveAttribute("tabIndex", "0");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(1);
    fireEvent.keyDown(row, { key: " " });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("tabela ma dostępną nazwę (caption/aria-label)", () => {
    render(<OpportunityTable items={[item({})]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByRole("table", { name: /okazje arbitrażowe/i })).toBeInTheDocument();
  });

  it("directionLabel tłumaczy kierunki bazy na polski opis", () => {
    expect(directionLabel("a_to_b")).toBe("A→B (Uniswap→Sushi)");
    expect(directionLabel("b_to_a")).toBe("B→A");
    expect(directionLabel("none")).toBe("—");
    expect(directionLabel("cokolwiek")).toBe("cokolwiek");
  });

  it("directionShort zwraca krótką formę kierunku (dla komórki tabeli)", () => {
    expect(directionShort("a_to_b")).toBe("A→B");
    expect(directionShort("b_to_a")).toBe("B→A");
    expect(directionShort("none")).toBe("—");
    expect(directionShort("cokolwiek")).toBe("cokolwiek");
  });

  it("statusLabel mapuje wszystkie statusy, brak -> niezweryfikowana", () => {
    expect(statusLabel("decayed")).toBe("wygasła");
    expect(statusLabel("persisted")).toBe("utrzymała się");
    expect(statusLabel("consumed_partial")).toBe("skonsumowana częściowo");
    expect(statusLabel("consumed_atomic")).toBe("skonsumowana (atomowo)");
    expect(statusLabel(null)).toBe("niezweryfikowana");
    expect(statusLabel(undefined)).toBe("niezweryfikowana");
  });

  it("statusShortLabel skraca etykiety dla pigułki w tabeli, brak -> niezweryfikowana", () => {
    expect(statusShortLabel("decayed")).toBe("wygasła");
    expect(statusShortLabel("persisted")).toBe("utrzymała się");
    expect(statusShortLabel("consumed_partial")).toBe("częściowo");
    expect(statusShortLabel("consumed_atomic")).toBe("atomowo");
    expect(statusShortLabel(null)).toBe("niezweryfikowana");
    expect(statusShortLabel(undefined)).toBe("niezweryfikowana");
  });

  it("fmtUsd/fmtPct formatują liczby po polsku, null -> myślnik", () => {
    expect(fmtUsd(null)).toBe("—");
    expect(fmtUsd(20.5)).toBe("20,5 $");
    expect(fmtPct(0.65)).toBe("0,650 %");
  });

  it("pokazuje kolumnę Model tylko gdy podano modelName, z wynikiem albo myślnikiem", () => {
    render(
      <OpportunityTable
        items={[item({ id: 1, scores: { mamdani: { score: 42.1, label: "wykonalna" } } }), item({ id: 2, scores: { mamdani: null } })]}
        selectedId={null}
        onSelect={() => {}}
        modelName="mamdani"
      />,
    );
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("42.1 (wykonalna)")).toBeInTheDocument();
  });

  it("bez modelName nie renderuje kolumny Model", () => {
    render(<OpportunityTable items={[item({})]} selectedId={null} onSelect={() => {}} />);
    expect(screen.queryByText("Model")).not.toBeInTheDocument();
  });
});
