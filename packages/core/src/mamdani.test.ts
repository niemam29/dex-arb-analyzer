import { readFileSync } from "node:fs";
import { invRamp as fzInvRamp, negate as fzNegate, ramp as fzRamp, triangle as fzTriangle, type FuzzyFn } from "@thi.ng/fuzzy";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAMDANI_PARAMS,
  mamdaniParamsSchema,
  termShapeSchema,
  type InputName,
  type MamdaniParams,
  type TermShape,
} from "./mamdani.params.js";
import { buildMamdani, createMamdaniModel, evaluateArbitrage } from "./mamdani.js";

interface Scenario {
  name: string; S: number; G: number; L: number; M: number; W: number; label: string;
}
const scenarios: Scenario[] = JSON.parse(
  readFileSync(new URL("../test/fixtures/scenarios.json", import.meta.url), "utf8"),
);
const TOL = 0.5; // kryterium ze sprawozdania: |ΔW| ≤ 0,5 pkt i identyczna etykieta

describe("mamdani — 6 scenariuszy ze sprawozdania", () => {
  it.each(scenarios)("$name", (s) => {
    const r = evaluateArbitrage({ S: s.S, G: s.G, L: s.L, M: s.M });
    expect(Math.abs(r.value - s.W)).toBeLessThanOrEqual(TOL);
    expect(r.label).toBe(s.label);
  });

  it("zwraca 16 aktywacji reguł R1–R16", () => {
    const r = evaluateArbitrage({ S: 1.3576, G: 0.068, L: 100, M: 22.26 });
    expect(r.activations.map((a) => a.id)).toEqual(
      Array.from({ length: 16 }, (_, i) => `R${i + 1}`),
    );
    expect(r.activations.every((a) => a.strength >= 0 && a.strength <= 1)).toBe(true);
  });
});

describe("MamdaniParams", () => {
  it("domyślne parametry przechodzą walidację zod i round-trip JSON", () => {
    const json = JSON.parse(JSON.stringify(DEFAULT_MAMDANI_PARAMS));
    expect(mamdaniParamsSchema.parse(json)).toEqual(DEFAULT_MAMDANI_PARAMS);
  });

  it("zmiana parametru zmienia wynik (parametry nie są zaszyte w kodzie)", () => {
    const tuned = structuredClone(DEFAULT_MAMDANI_PARAMS);
    tuned.inputs.S.terms["znikoma"] = { kind: "invRamp", a: 0.6, b: 1.2 }; // szersze „znikoma”
    const base = buildMamdani().evaluate({ S: 0.7, G: 0.15, L: 80, M: 30 }).value;
    const alt = buildMamdani(tuned).evaluate({ S: 0.7, G: 0.15, L: 80, M: 30 }).value;
    expect(alt).toBeLessThan(base);
  });

  it("odrzuca regułę z nieznanym termem", () => {
    const bad = structuredClone(DEFAULT_MAMDANI_PARAMS);
    bad.rules[0]!.if = { S: "nie_istnieje" };
    expect(() => buildMamdani(bad)).toThrow(/nieznany term/);
  });

  it("odrzuca regułę z termem będącym nazwą własności Object.prototype (np. 'constructor')", () => {
    const bad = structuredClone(DEFAULT_MAMDANI_PARAMS);
    bad.rules[0]!.if = { S: "constructor" };
    expect(() => buildMamdani(bad)).toThrow(/nieznany term/);
  });

  it("odrzuca regułę z pustym `if` (Math.min(...[]) dałby Infinity)", () => {
    const bad = structuredClone(DEFAULT_MAMDANI_PARAMS);
    bad.rules[0]!.if = {};
    expect(() => buildMamdani(bad)).toThrow(/co najmniej jeden warunek/);
  });

  it("odrzuca output.terms z kluczem spoza LABELS", () => {
    const bad = structuredClone(DEFAULT_MAMDANI_PARAMS);
    bad.output.terms = { foo: { kind: "ramp", a: 0, b: 1 } };
    expect(() => buildMamdani(bad)).toThrow();
  });

  it("odrzuca puste output.terms", () => {
    const bad = structuredClone(DEFAULT_MAMDANI_PARAMS);
    bad.output.terms = {};
    expect(() => buildMamdani(bad)).toThrow();
  });

  it("odrzuca term wejściowy o nazwie zaczynającej się od 'nie_' (koliduje z negacją buildMamdani)", () => {
    const bad = structuredClone(DEFAULT_MAMDANI_PARAMS);
    bad.inputs.S.terms["nie_x"] = { kind: "ramp", a: 0, b: 1 };
    expect(() => buildMamdani(bad)).toThrow();
  });

  it("odrzuca domain[0] >= domain[1]", () => {
    const bad = structuredClone(DEFAULT_MAMDANI_PARAMS);
    bad.inputs.S.domain = [3, 0];
    expect(() => buildMamdani(bad)).toThrow();
  });

  it("odrzuca samples > 10000", () => {
    const bad = structuredClone(DEFAULT_MAMDANI_PARAMS);
    bad.samples = 20000;
    expect(() => buildMamdani(bad)).toThrow();
  });
});

describe("termShapeSchema — sanity kształtów", () => {
  it("odrzuca triangle(5,1,0) (a<=b<=c i a<c naruszone)", () => {
    expect(termShapeSchema.safeParse({ kind: "triangle", a: 5, b: 1, c: 0 }).success).toBe(false);
  });

  it("odrzuca ramp z a >= b", () => {
    expect(termShapeSchema.safeParse({ kind: "ramp", a: 1, b: 1 }).success).toBe(false);
  });

  it("odrzuca invRamp z a >= b", () => {
    expect(termShapeSchema.safeParse({ kind: "invRamp", a: 2, b: 1 }).success).toBe(false);
  });

  it("akceptuje poprawny triangle i ramp", () => {
    expect(termShapeSchema.safeParse({ kind: "triangle", a: 0, b: 1, c: 2 }).success).toBe(true);
    expect(termShapeSchema.safeParse({ kind: "ramp", a: 0, b: 1 }).success).toBe(true);
  });
});

describe("createMamdaniModel — adapter ScoringModel", () => {
  it("mapuje Features na S/G/L/M i zwraca score 0–100 z etykietą", () => {
    const model = createMamdaniModel();
    const out = model.score({ S: 0.7, G: 0.15, L: 80, M: 30, netProfitUsd: 0, grossProfitUsd: 0, optTradeUsd: 0 });
    expect(model.kind).toBe("mamdani");
    expect(Math.abs(out.score - 65)).toBeLessThanOrEqual(TOL);
    expect(out.label).toBe("wykonalna");
  });
});

// --- utwardzenie (kontroler): kolejność LABELS, params: unknown, jedna siła reguły, fallback ---

describe("kolejność etykiet wyjściowych — LABELS, nie Object.keys(p.output.terms)", () => {
  it("remis przynależności rozstrzyga kolejność LABELS, nie kolejność kluczy w obiekcie params", () => {
    // Fallback (żadna reguła się nie odpaliła) daje deterministyczną wartość — środek
    // dziedziny wyjścia — więc można nim precyzyjnie wymusić remis przynależności.
    // Klucze output.terms są celowo w kolejności ODWROTNEJ do LABELS: gdyby implementacja
    // iterowała Object.keys(...), przy remisie wygrałaby "wykonalna" (pierwszy klucz);
    // poprawna implementacja (kolejność LABELS: ...,"ryzykowna","wykonalna",...) daje "ryzykowna".
    const params: MamdaniParams = {
      inputs: DEFAULT_MAMDANI_PARAMS.inputs,
      output: {
        unit: "pkt",
        domain: [0, 100],
        terms: {
          wykonalna: { kind: "ramp", a: 40, b: 60 },
          ryzykowna: { kind: "invRamp", a: 40, b: 60 },
        },
      },
      // S=5 -> znikoma(5)=0 (poza invRamp(0,3, 0,65)) => reguła się nie odpala => fallback
      rules: [{ id: "R1", if: { S: "znikoma" }, then: "wykonalna" }],
      samples: 10,
    };
    const r = evaluateArbitrage({ S: 5, G: 0, L: 0, M: 0 }, params);
    expect(r.activations[0]!.strength).toBe(0);
    expect(r.value).toBe(50); // środek [0,100]
    // przy value=50: wykonalna=ramp(40,60)(50)=0.5, ryzykowna=invRamp(40,60)(50)=0.5 — remis
    expect(r.label).toBe("ryzykowna");
  });
});

/** Symuluje porządkowanie kluczy obiektu przez jsonb Postgresa: rosnąco wg (długość, bajty). */
function reorderLikePostgresJsonb(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderLikePostgresJsonb);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, reorderLikePostgresJsonb(v)] as const)
      .sort(([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries);
  }
  return value;
}

describe("round-trip przez porządkowanie kluczy jak w jsonb Postgresa", () => {
  it("value i label są identyczne dla oryginalnych i przetasowanych kluczy params, na siatce wejść", () => {
    const reordered = reorderLikePostgresJsonb(
      JSON.parse(JSON.stringify(DEFAULT_MAMDANI_PARAMS)),
    ) as MamdaniParams;
    // sanity: reorderLikePostgresJsonb faktycznie zmienia kolejność (inaczej test nic nie sprawdza)
    expect(Object.keys(reordered.output.terms)).not.toEqual(Object.keys(DEFAULT_MAMDANI_PARAMS.output.terms));

    for (const S of [0.2, 0.65, 1.3, 2.5]) {
      for (const G of [0.05, 0.5, 1.2]) {
        for (const L of [1, 20, 70]) {
          for (const M of [10, 55, 95]) {
            const crisp = { S, G, L, M };
            const original = evaluateArbitrage(crisp);
            const withReorderedParams = evaluateArbitrage(crisp, reordered);
            expect(withReorderedParams.value).toBeCloseTo(original.value, 9);
            expect(withReorderedParams.label).toBe(original.label);
          }
        }
      }
    }
  });
});

describe("buildMamdani / evaluateArbitrage / createMamdaniModel — params: unknown (granica zaufania)", () => {
  it("buildMamdani akceptuje JSON zwalidowany dopiero wewnątrz (params: unknown)", () => {
    const json: unknown = JSON.parse(JSON.stringify(DEFAULT_MAMDANI_PARAMS));
    const engine = buildMamdani(json);
    expect(engine.evaluate({ S: 0.7, G: 0.15, L: 80, M: 30 }).label).toBe("wykonalna");
  });

  it("buildMamdani odrzuca unknown niezgodny ze schematem", () => {
    const bogus: unknown = { foo: "bar" };
    expect(() => buildMamdani(bogus)).toThrow();
  });

  it("evaluateArbitrage i createMamdaniModel przyjmują params: unknown", () => {
    const json: unknown = JSON.parse(JSON.stringify(DEFAULT_MAMDANI_PARAMS));
    expect(evaluateArbitrage({ S: 0.7, G: 0.15, L: 80, M: 30 }, json).label).toBe("wykonalna");
    const model = createMamdaniModel(json);
    expect(model.score({ S: 0.7, G: 0.15, L: 80, M: 30, netProfitUsd: 0, grossProfitUsd: 0, optTradeUsd: 0 }).label).toBe("wykonalna");
  });
});

describe("siła reguły — spójność z AND=min biblioteki (rule.op)", () => {
  const shapeToFn = (s: TermShape): FuzzyFn =>
    s.kind === "ramp" ? fzRamp(s.a, s.b) : s.kind === "invRamp" ? fzInvRamp(s.a, s.b) : fzTriangle(s.a, s.b, s.c);
  // Referencja niezależna od mamdani.ts: rekonstruuje przynależności bezpośrednio
  // z kształtów w DEFAULT_MAMDANI_PARAMS i prymitywów biblioteki (ramp/invRamp/negate).
  const termFn = (input: InputName, term: string): FuzzyFn => {
    const shapes = DEFAULT_MAMDANI_PARAMS.inputs[input].terms;
    return term.startsWith("nie_") ? fzNegate(shapeToFn(shapes[term.slice(4)]!)) : shapeToFn(shapes[term]!);
  };

  it("dla każdej z 16 reguł: strength z activations == min niezależnie policzonych przynależności warunków if", () => {
    const grid = [
      { S: 0.2, G: 0.05, L: 1, M: 10 },
      { S: 0.65, G: 0.3, L: 20, M: 55 },
      { S: 1.0, G: 0.5, L: 40, M: 75 },
      { S: 1.3576, G: 0.06795962155390277, L: 100, M: 22.262495477334987 },
      { S: 1.8, G: 0.9, L: 3, M: 90 },
      { S: 2.5, G: 0.7, L: 60, M: 35 },
    ];
    for (const crisp of grid) {
      const r = evaluateArbitrage(crisp);
      for (const rule of DEFAULT_MAMDANI_PARAMS.rules) {
        const expected = Math.min(
          ...Object.entries(rule.if).map(([v, term]) => termFn(v as InputName, term!)(crisp[v as InputName])),
        );
        const actual = r.activations.find((a) => a.id === rule.id)!.strength;
        expect(actual).toBeCloseTo(expected, 12);
      }
    }
  });
});

describe("fallback: żadna reguła się nie odpaliła", () => {
  it("z wyjściem DEFAULT_MAMDANI_PARAMS: wartość to środek dziedziny (50), etykieta 'ryzykowna'", () => {
    // Zredukowany zestaw reguł (podzbiór DEFAULT_MAMDANI_PARAMS.rules), ale inputs/output/domain
    // identyczne jak w DEFAULT_MAMDANI_PARAMS — to output/domain decydują o wartości i etykiecie
    // fallbacku. Pełny 16-regułowy DEFAULT_MAMDANI_PARAMS jest w praktyce kompletny (R1/R2
    // wetujące + komplementarne pary termów pokrywają całą przestrzeń S/G — zweryfikowano
    // siatką >150 tys. punktów), więc ta ścieżka nie jest osiągalna z pełnym zestawem reguł.
    const params: MamdaniParams = {
      inputs: DEFAULT_MAMDANI_PARAMS.inputs,
      output: DEFAULT_MAMDANI_PARAMS.output,
      rules: [
        DEFAULT_MAMDANI_PARAMS.rules.find((r) => r.id === "R1")!, // S: znikoma
        DEFAULT_MAMDANI_PARAMS.rules.find((r) => r.id === "R5")!, // S: umiarkowana, G: niski, L: gleboka, M: niskie
        DEFAULT_MAMDANI_PARAMS.rules.find((r) => r.id === "R10")!, // S: duza, G: niski, L: gleboka, M: niskie
      ],
      samples: DEFAULT_MAMDANI_PARAMS.samples,
    };
    // S=1.5: poza znikoma (R1 martwa) i poza umiarkowana (R5 martwa); G=1.5: poza niski (R10 martwa)
    const r = evaluateArbitrage({ S: 1.5, G: 1.5, L: 0, M: 0 }, params);
    expect(r.activations).toHaveLength(3);
    expect(r.activations.every((a) => a.strength === 0)).toBe(true);
    expect(r.value).toBe(50);
    expect(r.label).toBe("ryzykowna");
  });
});
