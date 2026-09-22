// Testy funkcji czystych CLI raportu pokrycia: łączenie loadCoverage +
// okazje/weryfikacje + nazwy, formatowanie tabeli. Uwaga: workspace vitest obejmuje
// tylko `packages/*/src/**/*.test.ts` i `packages/*/test/**/*.test.ts` — pliki w `scripts/` (jak
// ten) NIE są częścią `npm test`/`npx vitest run` domyślnego zbioru. Uruchom jawnie:
// `npx vitest run packages/api/scripts/coverage.test.ts`.
import { describe, expect, it } from "vitest";
import type { CoverageCellDto } from "@dex-arb/shared";
import { buildReport, formatTable, type VerificationCounts } from "./coverage.js";

const pairs = [{ id: 1, symbol: "WETH/USDC" }, { id: 5, symbol: "WBTC/WETH" }];
const windows = [{ id: 2, name: "2021-05 krach" }];

const cellA: CoverageCellDto = {
  pair_id: 1,
  window_id: 2,
  window_has_blocks: true,
  pools: [
    { pool_id: 1, dex_name: "uniswap-v2", done_blocks: 77_388, failed_blocks: 0, pending_blocks: 0, total_blocks: 77_388, coverage_pct: 100 },
    { pool_id: 3, dex_name: "sushiswap", done_blocks: 77_388, failed_blocks: 0, pending_blocks: 0, total_blocks: 77_388, coverage_pct: 100 },
  ],
  block_states: 77_388,
  states_min_block: 12_429_199,
  states_max_block: 12_506_592,
  scored_models: 1,
};
const cellB: CoverageCellDto = {
  pair_id: 5,
  window_id: 2,
  window_has_blocks: true,
  pools: [
    { pool_id: 8, dex_name: "uniswap-v2", done_blocks: 0, failed_blocks: 0, pending_blocks: 77_388, total_blocks: 77_388, coverage_pct: 0 },
    { pool_id: 9, dex_name: "sushiswap", done_blocks: 0, failed_blocks: 0, pending_blocks: 77_388, total_blocks: 77_388, coverage_pct: 0 },
  ],
  block_states: 0,
  states_min_block: null,
  states_max_block: null,
  scored_models: 0,
};

describe("buildReport", () => {
  it("łączy loadCoverage z liczbą okazji/weryfikacji i nazwami par/okien, sortuje po (okno, para)", () => {
    const opportunityCounts = new Map([["1:2", 1004]]);
    const verifications = new Map<string, VerificationCounts>([
      ["1:2", { total: 1004, byStatus: { consumed_atomic: 610, decayed: 394 } }],
    ]);
    const rows = buildReport([cellB, cellA], pairs, windows, opportunityCounts, verifications);
    expect(rows.map((r) => r.pair)).toEqual(["WBTC/WETH", "WETH/USDC"]);
    const weth = rows.find((r) => r.pair === "WETH/USDC")!;
    expect(weth.window).toBe("2021-05 krach");
    expect(weth.opportunities).toBe(1004);
    expect(weth.verifications).toEqual({ total: 1004, byStatus: { consumed_atomic: 610, decayed: 394 } });
    const wbtc = rows.find((r) => r.pair === "WBTC/WETH")!;
    expect(wbtc.opportunities).toBe(0);
    expect(wbtc.verifications).toEqual({ total: 0, byStatus: {} });
  });

  it("para/okno bez nazwy w katalogu -> etykieta #id (odporność na niespójność danych)", () => {
    const rows = buildReport([cellA], [], [], new Map(), new Map());
    expect(rows[0]!.pair).toBe("#1");
    expect(rows[0]!.window).toBe("#2");
  });
});

describe("formatTable", () => {
  it("pusta lista -> komunikat", () => {
    expect(formatTable([])).toMatch(/brak danych/i);
  });

  it("wiersz zawiera % ingestu per pula, stany bloków min-max, okazje i weryfikacje wg statusu", () => {
    const opportunityCounts = new Map([["1:2", 1004]]);
    const verifications = new Map<string, VerificationCounts>([
      ["1:2", { total: 1004, byStatus: { consumed_atomic: 610, decayed: 394 } }],
    ]);
    const [row] = buildReport([cellA], pairs, windows, opportunityCounts, verifications);
    const table = formatTable([row!]);
    expect(table).toContain("WETH/USDC");
    expect(table).toContain("uniswap-v2=100%");
    expect(table).toContain("sushiswap=100%");
    expect(table).toContain("77388 (12429199–12506592)");
    expect(table).toContain("okazje: 1004");
    expect(table).toContain("zweryfikowane: 1004/1004");
    expect(table).toContain("consumed_atomic=610");
    expect(table).toContain("decayed=394");
  });

  it("okno bez rozstrzygniętych bloków -> ingest opisany jawnie, nie 'n/a' na siłę", () => {
    const cellUnresolved: CoverageCellDto = { ...cellA, window_has_blocks: false, pools: cellA.pools.map((p) => ({ ...p, coverage_pct: null })) };
    const [row] = buildReport([cellUnresolved], pairs, windows, new Map(), new Map());
    expect(formatTable([row!])).toContain("okno bez rozstrzygniętych bloków");
  });
});
