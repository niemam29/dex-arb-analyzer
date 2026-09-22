import { describe, expect, it } from "vitest";
import { destandardize, fitStandardizer, standardize } from "../../src/anfis/standardize.js";

describe("standardize", () => {
  it("daje średnią 0 i odchylenie 1 per kolumna", () => {
    const X = [
      [1, 10],
      [2, 20],
      [3, 30],
      [4, 40],
    ];
    const s = fitStandardizer(X);
    expect(s.mean).toEqual([2.5, 25]);
    const Z = X.map((x) => standardize(x, s));
    const mean0 = Z.reduce((a, z) => a + z[0]!, 0) / 4;
    expect(mean0).toBeCloseTo(0, 10);
    expect(Z[3]![1]).toBeCloseTo(1.3416, 3);
  });

  it("kolumna stała dostaje std=1 (bez dzielenia przez 0)", () => {
    const s = fitStandardizer([
      [5, 1],
      [5, 2],
    ]);
    expect(s.std[0]).toBe(1);
  });

  it("destandardize odwraca standardize (round-trip)", () => {
    const X = [
      [1, 10],
      [2, 20],
      [3, 30],
      [4, 40],
    ];
    const s = fitStandardizer(X);
    for (const x of X) {
      const z = standardize(x, s);
      const back = destandardize(z, s);
      expect(back[0]).toBeCloseTo(x[0]!, 10);
      expect(back[1]).toBeCloseTo(x[1]!, 10);
    }
  });
});
