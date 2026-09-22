// Test jednostkowy parsowania wiersza CSV importu (`import:csv`) — bez Postgresa.
// Pokrywa: mapowanie sync/swap na struktury z NULL-ami dla swap, mapowanie aliasów puli,
// wykrywanie uszkodzonego logIndex (reguła: > 1 000 000 lub nieskończona/niecałkowita wartość —
// prawdziwy logIndex w bloku nigdy nie przekracza ~1200, uszkodzone wartości z przepełnienia
// uint32 zaczynają się od ~4 294 967 137 — ADR 0001).
import { describe, expect, it } from "vitest";
import { parseEventLine } from "../src/jobs/import-csv.js";

const ALIASES = { uniswap: 1, sushiswap: 2 };

describe("parseEventLine", () => {
  it("parsuje wiersz sync z rezerwami", () => {
    const row = parseEventLine(
      "12429200,132,uniswap,sync,0x7a6f0482e2de7d67f3d93fae464bf10214dd945f2326d1cb1c318347c840ec8a,163737114053377,44004147832345236861057,3720.9473,",
      2,
      ALIASES,
    );
    expect(row).toMatchObject({
      kind: "sync",
      poolId: 1,
      block: 12429200,
      logIndex: 132,
      txHash: "0x7a6f0482e2de7d67f3d93fae464bf10214dd945f2326d1cb1c318347c840ec8a",
      reserve0: "163737114053377",
      reserve1: "44004147832345236861057",
    });
    expect(row.corrupted).toBe(false);
  });

  it("parsuje wiersz swap bez kwot/sendera (puste pola CSV → brak rezerw w wyniku)", () => {
    const row = parseEventLine(
      "12429200,133,uniswap,swap,0x7a6f0482e2de7d67f3d93fae464bf10214dd945f2326d1cb1c318347c840ec8a,,,,4624.78",
      3,
      ALIASES,
    );
    expect(row).toMatchObject({ kind: "swap", poolId: 1, block: 12429200, logIndex: 133 });
    expect(row).not.toHaveProperty("reserve0");
    expect(row).not.toHaveProperty("reserve1");
  });

  it("mapuje alias puli na id z poolAliases", () => {
    const row = parseEventLine(
      "12429201,10,sushiswap,sync,0x00000000000000000000000000000000000000000000000000000000000000aa,1,2,,",
      4,
      ALIASES,
    );
    expect(row.poolId).toBe(2);
  });

  it("nieznany alias puli → błąd z numerem linii i nazwą aliasu", () => {
    expect(() => parseEventLine("1,1,kraken,sync,0xdead,1,2,,", 7, ALIASES)).toThrow(/linia 7.*kraken/);
  });

  it("nieznany typ zdarzenia → błąd z numerem linii", () => {
    expect(() => parseEventLine("1,1,uniswap,mint,0xdead,1,2,,", 9, ALIASES)).toThrow(/linia 9/);
  });

  it("wykrywa uszkodzony logIndex (przepełnienie uint32, wartość > 1 000 000)", () => {
    const row = parseEventLine(
      "12429226,4294967286,uniswap,sync,0xbcb351df9cf4c48e46489d2184f8a71de3c119632c7b4ed4f48a3d1b93af71e1,1,2,,",
      6,
      ALIASES,
    );
    expect(row.logIndex).toBe(4294967286);
    expect(row.corrupted).toBe(true);
  });

  it("logIndex tuż powyżej progu (1 000 001) jest uznawany za uszkodzony", () => {
    const row = parseEventLine("1,1000001,uniswap,sync,0xdead,1,2,,", 10, ALIASES);
    expect(row.corrupted).toBe(true);
  });

  it("logIndex na progu (1 000 000) NIE jest uznawany za uszkodzony", () => {
    const row = parseEventLine("1,1000000,uniswap,sync,0xdead,1,2,,", 11, ALIASES);
    expect(row.corrupted).toBe(false);
  });

  it("nieliczbowy/niecałkowity logIndex jest uznawany za uszkodzony", () => {
    expect(parseEventLine("1,abc,uniswap,sync,0xdead,1,2,,", 12, ALIASES).corrupted).toBe(true);
    expect(parseEventLine("1,12.5,uniswap,sync,0xdead,1,2,,", 13, ALIASES).corrupted).toBe(true);
  });
});
