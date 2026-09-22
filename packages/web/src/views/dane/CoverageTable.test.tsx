// Siatka pokrycia par×okien (karta per komórka) — paski pokrycia per pula, przyciski zadań
// (Pobierz/Analizuj/Weryfikuj) i linki Okno/Okazje. Od redesignu 2026-08-27 to siatka kart, nie
// <table> — asercje na role list/listitem i tekstach.
import { it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { CoverageCellDto, PairDto, WindowDto } from "@dex-arb/shared";
import { CoverageTable } from "./CoverageTable";

const pairs: PairDto[] = [
  {
    id: 1,
    symbol: "WETH/USDC",
    token_base: "0x1",
    token_quote: "0x2",
    pools: [
      { id: 1, dex_id: 1, dex_name: "Uniswap V2", address: "0xa" },
      { id: 2, dex_id: 2, dex_name: "Sushiswap", address: "0xb" },
    ],
  },
];
const windows: WindowDto[] = [
  { id: 1, name: "maj 2021", from_ts: "2021-05-14T00:00:00Z", to_ts: "2021-05-26T00:00:00Z", from_block: 1, to_block: 1000 },
];
const coverage: CoverageCellDto[] = [
  {
    pair_id: 1,
    window_id: 1,
    window_has_blocks: true,
    block_states: 0,
    states_min_block: null,
    states_max_block: null,
    scored_models: 0,
    pools: [
      { pool_id: 1, dex_name: "Uniswap V2", done_blocks: 600, failed_blocks: 0, pending_blocks: 400, total_blocks: 1000, coverage_pct: 60 },
      { pool_id: 2, dex_name: "Sushiswap", done_blocks: 0, failed_blocks: 0, pending_blocks: 0, total_blocks: 1000, coverage_pct: 0 },
    ],
  },
];

function renderGrid(cov: CoverageCellDto[], onAction = vi.fn()) {
  render(
    <MemoryRouter>
      <CoverageTable pairs={pairs} windows={windows} coverage={cov} onAction={onAction} />
    </MemoryRouter>,
  );
  return onAction;
}

it("pokazuje pokrycie per pula (nazwa, procent, pasek) i wywołuje onAction", async () => {
  const onAction = renderGrid(coverage);
  expect(screen.getByText("WETH/USDC")).toBeInTheDocument();
  expect(screen.getByText("maj 2021")).toBeInTheDocument();
  const uni = screen.getByText("Uniswap V2").closest(".pool-row") as HTMLElement;
  expect(within(uni).getByText("60%")).toBeInTheDocument();
  expect(within(uni).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0.6");
  const sushi = screen.getByText("Sushiswap").closest(".pool-row") as HTMLElement;
  expect(within(sushi).getByText("0%")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Pobierz" }));
  expect(onAction).toHaveBeenCalledWith("ingest", pairs[0], windows[0]);
});

it("Analizuj jest aktywny przy 100% pokrycia; link Okno gdy są block_states", () => {
  const baseCell = coverage[0]!;
  renderGrid([
    {
      ...baseCell,
      block_states: 10,
      pools: baseCell.pools.map((p) => ({ ...p, done_blocks: 1000, coverage_pct: 100 })),
    },
  ]);
  expect(screen.getByRole("button", { name: "Analizuj" })).toBeEnabled();
  expect(screen.getByRole("link", { name: "Okno" })).toHaveAttribute("href", "/okno/1/1");
});

it("Analizuj i Weryfikuj są nieaktywne, gdy brak danych dla komórki", () => {
  renderGrid([]);
  expect(screen.getByRole("button", { name: "Analizuj" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Weryfikuj" })).toBeDisabled();
  expect(screen.queryByRole("link", { name: "Okno" })).not.toBeInTheDocument();
  expect(screen.getByText("brak danych")).toBeInTheDocument();
});

it("Weryfikuj jest aktywny, gdy block_states > 0, i zleca verify:pair-window", async () => {
  const onAction = renderGrid([{ ...coverage[0]!, block_states: 10, scored_models: 3 }]);
  const button = screen.getByRole("button", { name: "Weryfikuj" });
  expect(button).toBeEnabled();
  await userEvent.click(button);
  expect(onAction).toHaveBeenCalledWith("verify", pairs[0], windows[0]);
  expect(screen.getByRole("link", { name: "Okazje" })).toHaveAttribute("href", "/okazje/1/1");
  expect(screen.getByText("stany")).toBeInTheDocument();
  expect(screen.getByText("10")).toBeInTheDocument();
  expect(screen.getByText("modele")).toBeInTheDocument();
  expect(screen.getByText("3")).toBeInTheDocument();
});

it("błędy ingestu: pasek w tonie warn i liczba błędnych bloków w kolorze danger", () => {
  const baseCell = coverage[0]!;
  renderGrid([{ ...baseCell, pools: [{ ...baseCell.pools[0]!, failed_blocks: 12 }, baseCell.pools[1]!] }]);
  const uni = screen.getByText("Uniswap V2").closest(".pool-row") as HTMLElement;
  expect(within(uni).getByRole("progressbar")).toHaveClass("bar--warn");
  expect(within(uni).getByText("błędy: 12 bl.")).toHaveClass("pool-failed");
});

it("siatka pokrycia ma dostępną nazwę (aria-label) i rolę list", () => {
  renderGrid(coverage);
  expect(screen.getByRole("list", { name: /pokrycie/i })).toBeInTheDocument();
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
});
