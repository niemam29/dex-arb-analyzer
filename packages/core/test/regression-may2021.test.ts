/**
 * Regresja: cechy S/G/L/M i etykiety Mamdaniego muszą się zgadzać 1:1 z ewaluacją
 * wykonaną przez implementację referencyjną na tym samym oknie historycznym
 * (maj 2021, WETH/USDC, Uniswap V2 + Sushiswap V2, 77 388 bloków).
 * Pomijane, gdy REFERENCE_DATA_DIR nie jest ustawione (dane spoza tego repo).
 */
import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import { computeRawFeatures, interpolateLinear } from "../src/features.js";
import { evaluateArbitrage } from "../src/mamdani.js";
import { PROJECT_DATA, projectFile, readCsv } from "./helpers/csv.js";

describe.skipIf(!PROJECT_DATA)("regresja: cechy i etykiety Mamdaniego, maj 2021 (ratings.csv)", () => {
  it("S/G/L/M zgodne z ratings.csv (|Δ| ≤ 1e-3) i rozkład 99,09/0,83/0,07/0,01 %", () => {
    const spreads = readCsv(projectFile("block_spreads.csv"));
    const gas = readCsv(projectFile("gas_sample.csv"))
      .map((r) => ({ block: +r.blockNumber!, gwei: +r.gasPriceGwei! }))
      .sort((a, b) => a.block - b.block);
    const gasXs = gas.map((g) => g.block);
    const gasYs = gas.map((g) => g.gwei);
    // liczba swapów w bloku (obie pule) z events.csv — strumieniowo, kolumna 3 = type, 0 = blockNumber
    const swaps = new Map<number, number>();
    for (const line of fs.readFileSync(projectFile("events.csv"), "utf8").split("\n")) {
      const p = line.split(",");
      if (p[3] === "swap") swaps.set(+p[0]!, (swaps.get(+p[0]!) ?? 0) + 1);
    }
    const pct = {
      sortedSwapCounts: spreads.map((r) => swaps.get(+r.block!) ?? 0).sort((a, b) => a - b),
      sortedGasGwei: spreads.map((r) => interpolateLinear(gasXs, gasYs, +r.block!)).sort((a, b) => a - b),
    };
    const ratings = new Map(readCsv(projectFile("ratings.csv")).map((r) => [+r.block!, r]));
    const counts: Record<string, number> = {};
    const maxDiffByKey: Record<"S" | "G" | "L" | "M", number> = { S: 0, G: 0, L: 0, M: 0 };
    for (const r of spreads) {
      const block = +r.block!;
      const f = computeRawFeatures(
        {
          spreadPct: +r.spreadPct!,
          tvlMinUsd: +r.tvlMinMlnUsd! * 1e6,
          gasPriceGwei: interpolateLinear(gasXs, gasYs, block),
          ethUsd: +r.priceUni!,
          swapsInBlock: swaps.get(block) ?? 0,
        },
        pct,
      );
      const ref = ratings.get(block)!;
      for (const k of ["S", "G", "L", "M"] as const)
        maxDiffByKey[k] = Math.max(maxDiffByKey[k], Math.abs(f[k] - +ref[k]!));
      const res = evaluateArbitrage(f);
      counts[res.label] = (counts[res.label] ?? 0) + 1;
      expect(res.label, `blok ${block}`).toBe(ref.label);
    }
    // ratings.csv zapisuje S/G z 4 miejscami po przecinku, L/M z 1 (evaluate.ts: .toFixed(1)),
    // więc błąd zaokrąglenia samego zapisu do CSV sięga 0,05 dla L i M — porównujemy z tym
    // marginesem; S i G mają ciaśniejszą tolerancję odpowiadającą ich precyzji zapisu.
    expect(maxDiffByKey.S).toBeLessThanOrEqual(1e-3);
    expect(maxDiffByKey.G).toBeLessThanOrEqual(1e-3);
    expect(maxDiffByKey.L).toBeLessThanOrEqual(0.05);
    expect(maxDiffByKey.M).toBeLessThanOrEqual(0.05);
    const n = spreads.length;
    expect(n).toBe(77_388);
    expect((100 * counts.niewykonalna!) / n).toBeCloseTo(99.09, 1);
    expect((100 * counts.ryzykowna!) / n).toBeCloseTo(0.83, 1);
    expect((100 * counts.wykonalna!) / n).toBeCloseTo(0.07, 1);
    expect((100 * counts.atrakcyjna!) / n).toBeCloseTo(0.01, 1);
  }, 120_000);
});
