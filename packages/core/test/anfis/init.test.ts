import { describe, expect, it } from "vitest";
import { membership, SQRT_2LN2 } from "../../src/anfis/gaussian.js";
import { anfisParamsSchema, gaussFromTerm, initFromMamdani } from "../../src/anfis/init.js";
import { DEFAULT_MAMDANI_PARAMS } from "../../src/mamdani.params.js";

describe("gaussFromTerm", () => {
  it("triangle: mu = wierzchołek, sigma z FWHM; średnia przynależności w punktach połówkowych trójkąta ≈ 0.5", () => {
    const g = gaussFromTerm({ kind: "triangle", a: 0.5, b: 0.9, c: 1.4 });
    expect(g).toEqual({ mu: 0.9, sigma: (1.4 - 0.5) / (4 * SQRT_2LN2), shape: "full" });
    // punkt połówkowy trójkąta po lewej: (a+b)/2 = 0.7, po prawej: (b+c)/2 = 1.15 — symetryczny
    // Gauss trafia dokładnie tylko dla trójkąta symetrycznego (a tu a≠2b-c), więc sprawdzamy średnią.
    const left = membership(g, 0.7);
    const right = membership(g, 1.15);
    expect((left + right) / 2).toBeCloseTo(0.5, 1);
  });

  it("invRamp: plateau od lewej (leftShoulder), 0.5 w (a+b)/2", () => {
    const g = gaussFromTerm({ kind: "invRamp", a: 0.3, b: 0.65 });
    expect(g.shape).toBe("leftShoulder");
    expect(g.mu).toBe(0.3);
    expect(membership(g, 0.3)).toBe(1);
    expect(membership(g, 0.475)).toBeCloseTo(0.5, 10);
  });

  it("ramp: plateau od prawej (rightShoulder), 0.5 w (a+b)/2", () => {
    const g = gaussFromTerm({ kind: "ramp", a: 1.1, b: 1.8 });
    expect(g.shape).toBe("rightShoulder");
    expect(g.mu).toBe(1.8);
    expect(membership(g, 1.8)).toBe(1);
    expect(membership(g, 1.45)).toBeCloseTo(0.5, 10);
  });
});

describe("initFromMamdani", () => {
  const p = initFromMamdani();

  it("ma 4 zmienne × 3 termy, 16 reguł, 5 współczynników na regułę", () => {
    expect(p.terms.map((t) => t.length)).toEqual([3, 3, 3, 3]);
    expect(p.termNames.map((t) => t.length)).toEqual([3, 3, 3, 3]);
    expect(p.rules).toHaveLength(16);
    expect(p.consequents).toHaveLength(16);
    expect(p.consequents.every((c) => c.length === 5)).toBe(true);
  });

  it("negacje mapują się na term bazowy z flagą negate (R9: L=nie_plytka)", () => {
    const r9 = p.rules.find((r) => r.id === "R9")!;
    const l = r9.clauses.find((c) => c.varIdx === 2)!; // 2 = L w VAR_ORDER
    expect(p.termNames[2]![l.termIdx]).toBe("plytka");
    expect(l.negate).toBe(true);
  });

  it("konsekwenty: t = logit(center/100), reszta 0 (R10 → atrakcyjna → 90)", () => {
    const r10 = p.rules.findIndex((r) => r.id === "R10");
    expect(p.consequents[r10]!.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(p.consequents[r10]![4]).toBeCloseTo(Math.log(0.9 / 0.1), 10);
  });

  it("konsekwenty: R1 → niewykonalna → 15", () => {
    const r1 = p.rules.findIndex((r) => r.id === "R1");
    expect(p.consequents[r1]![4]).toBeCloseTo(Math.log(0.15 / 0.85), 10);
  });

  it("domeny wejść i domyślny standaryzator odpowiadają S/G/L/M", () => {
    expect(p.domains).toEqual([
      [0, 3],
      [0, 2],
      [0, 100],
      [0, 100],
    ]);
    expect(p.standardizer).toEqual({ mean: [0, 0, 0, 0], std: [1, 1, 1, 1] });
  });

  it("liczba klauzul reguły odpowiada liczbie warunków `if` w DEFAULT_MAMDANI_PARAMS", () => {
    const r1 = p.rules.find((r) => r.id === "R1")!; // if: { S: "znikoma" }
    expect(r1.clauses).toHaveLength(1);
    const r10 = p.rules.find((r) => r.id === "R10")!; // if: { S, G, L, M }
    expect(r10.clauses).toHaveLength(4);
  });

  it("rzuca defensywnie, gdy reguła 'then' spoza LABELS", () => {
    const bad = {
      ...DEFAULT_MAMDANI_PARAMS,
      rules: [{ id: "RX", if: { S: "znikoma" }, then: "nie_takie_cos" }],
    };
    expect(() => initFromMamdani(bad)).toThrow(/nieznana etykieta/);
  });

  it("features = VAR_ORDER = ['S','G','L','M']", () => {
    expect(p.features).toEqual(["S", "G", "L", "M"]);
  });
});

describe("anfisParamsSchema", () => {
  const valid = initFromMamdani();

  it("akceptuje wyjście initFromMamdani()", () => {
    expect(() => anfisParamsSchema.parse(valid)).not.toThrow();
  });

  it("odrzuca sigma <= 0 (term Gaussa o niedodatniej szerokości)", () => {
    const bad = { ...valid, terms: valid.terms.map((ts, i) => (i === 0 ? [{ ...ts[0]!, sigma: 0 }, ...ts.slice(1)] : ts)) };
    expect(() => anfisParamsSchema.parse(bad)).toThrow();
    const negative = { ...valid, terms: valid.terms.map((ts, i) => (i === 0 ? [{ ...ts[0]!, sigma: -1 }, ...ts.slice(1)] : ts)) };
    expect(() => anfisParamsSchema.parse(negative)).toThrow();
  });

  it("odrzuca mu niewłaściwe (NaN/Infinity)", () => {
    const bad = { ...valid, terms: valid.terms.map((ts, i) => (i === 0 ? [{ ...ts[0]!, mu: Infinity }, ...ts.slice(1)] : ts)) };
    expect(() => anfisParamsSchema.parse(bad)).toThrow();
  });

  it("odrzuca standardizer.std <= 0", () => {
    const bad = { ...valid, standardizer: { ...valid.standardizer, std: [0, 1, 1, 1] } };
    expect(() => anfisParamsSchema.parse(bad)).toThrow();
  });

  it("odrzuca nieznany klucz na najwyższym poziomie (.strict())", () => {
    const bad = { ...valid, extraPole: 123 };
    expect(() => anfisParamsSchema.parse(bad)).toThrow();
  });

  it("odrzuca przestawioną kolejność cech (permutacja S/G/L/M)", () => {
    const bad = { ...valid, features: ["G", "S", "L", "M"] };
    expect(() => anfisParamsSchema.parse(bad)).toThrow();
  });
});
