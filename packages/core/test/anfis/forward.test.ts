import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { initFromMamdani } from "../../src/anfis/init.js";
import { clampToDomain, forward, predict, sigmoid } from "../../src/anfis/model.js";
import { mulberry32 } from "../../src/anfis/random.js";
import { MamdaniModel } from "../../src/mamdani.js";

interface Scenario {
  name: string;
  S: number;
  G: number;
  L: number;
  M: number;
}
const scenarios: Scenario[] = JSON.parse(
  readFileSync(new URL("../fixtures/scenarios.json", import.meta.url), "utf8"),
);

/**
 * Współczynnik korelacji rang Spearmana (z korektą na remisy — ranga = średnia pozycji
 * remisujących wartości), używany tylko w teście: sprawdza, czy ranking ANFIS bez treningu
 * jest zgodny z rankingiem Mamdaniego (spec §1.6).
 */
function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]): number[] => {
    const idx = v.map((_, i) => i).sort((i, j) => v[i]! - v[j]!);
    const r = Array<number>(v.length).fill(0);
    for (let k = 0; k < idx.length; ) {
      let m = k;
      while (m + 1 < idx.length && v[idx[m + 1]!] === v[idx[k]!]) m++;
      const avg = (k + m) / 2 + 1;
      for (let t = k; t <= m; t++) r[idx[t]!] = avg;
      k = m + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n;
  const mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

describe("sigmoid", () => {
  it("sigmoid(0) = 0.5, granice przy ±∞", () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(50)).toBeCloseTo(1, 9);
    expect(sigmoid(-50)).toBeCloseTo(0, 9);
  });
});

describe("clampToDomain", () => {
  const p = initFromMamdani();
  it("przycina wartości spoza dziedziny S/G/L/M", () => {
    expect(clampToDomain(p, [-1, 5, -10, 500])).toEqual([0, 2, 0, 100]);
  });
  it("NaN/Inf → dolna granica dziedziny (Number.isFinite odrzuca też Infinity)", () => {
    expect(clampToDomain(p, [NaN, Infinity, -Infinity, 50])).toEqual([0, 0, 0, 50]);
  });
});

describe("forward", () => {
  const p = initFromMamdani();

  it("wagi znormalizowane sumują się do 1, y ∈ (0,1), 16 sił odpalenia", () => {
    const c = forward(p, [1.2, 0.2, 40, 30]);
    expect(c.wBar.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(c.y).toBeGreaterThan(0);
    expect(c.y).toBeLessThan(1);
    expect(c.w).toHaveLength(16);
    expect(c.mu).toHaveLength(16);
  });

  it("wzorcowa okazja (duży spread, niski gaz, głęboka pula, niskie MEV) > 0.5", () => {
    expect(predict(p, [2.0, 0.15, 70, 20])).toBeGreaterThan(0.5);
  });

  it("rzuca, gdy p.features jest permutowane względem VAR_ORDER", () => {
    const permuted = { ...p, features: ["G", "S", "L", "M"] as unknown as typeof p.features };
    expect(() => forward(permuted, [1.2, 0.2, 40, 30])).toThrow(/features/);
  });

  it("rzuca, gdy p.features brakuje (undefined)", () => {
    const missing = { ...p, features: undefined as unknown as typeof p.features };
    expect(() => forward(missing, [1.2, 0.2, 40, 30])).toThrow(/features/);
  });

  it("znikomy spread < 0.3", () => {
    expect(predict(p, [0.2, 0.15, 70, 20])).toBeLessThan(0.3);
  });

  it("predict(x) === forward(x).y", () => {
    const x = [0.9, 0.3, 25, 60];
    expect(predict(p, x)).toBe(forward(p, x).y);
  });

  it.each(scenarios)("scenariusz ze sprawozdania: $name — score ∈ [0,100]", (s) => {
    const score = predict(p, [s.S, s.G, s.L, s.M]) * 100;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("ranking bez treningu jest skorelowany z Mamdanim (Spearman > 0.8) na siatce ~1200 punktów", () => {
    // Ta sama siatka co w regresji parytetu Mamdaniego (mamdani.test.ts) w rozszerzonej
    // formie — pokrywa wszystkie termy S/G/L/M, w tym wartości graniczne.
    const sGrid = [0, 0.4, 0.65, 0.7, 0.9, 1.3, 2, 3];
    const gGrid = [0.05, 0.15, 0.3, 0.5, 0.9, 1.5];
    const lGrid = [1.5, 6, 20, 50, 100];
    const mGrid = [10, 30, 50, 70, 95];

    const mam = new MamdaniModel();
    const a: number[] = [];
    const b: number[] = [];
    for (const S of sGrid) {
      for (const G of gGrid) {
        for (const L of lGrid) {
          for (const M of mGrid) {
            a.push(predict(p, [S, G, L, M]) * 100);
            b.push(mam.score({ S, G, L, M, netProfitUsd: 0, grossProfitUsd: 0, optTradeUsd: 0 }).score);
          }
        }
      }
    }
    expect(a.length).toBe(sGrid.length * gGrid.length * lGrid.length * mGrid.length);
    expect(spearman(a, b)).toBeGreaterThan(0.8);
  });

  it("ranking bez treningu jest skorelowany z Mamdanim (Spearman > 0.8) na 2000 losowych punktach", () => {
    const rng = mulberry32(11);
    const mam = new MamdaniModel();
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const x = [rng() * 3, rng() * 2, rng() * 100, rng() * 100];
      a.push(predict(p, x) * 100);
      b.push(mam.score({ S: x[0]!, G: x[1]!, L: x[2]!, M: x[3]!, netProfitUsd: 0, grossProfitUsd: 0, optTradeUsd: 0 }).score);
    }
    expect(spearman(a, b)).toBeGreaterThan(0.8);
  });
});
