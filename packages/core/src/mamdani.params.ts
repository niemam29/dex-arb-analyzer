import { z } from "zod";
import { LABELS } from "./types.js";

/** Prefiks negacji termu wejściowego (np. "nie_plytka") dobudowywanej przez buildMamdani. */
export const NEG_PREFIX = "nie_";

const rampShape = z.object({ kind: z.literal("ramp"), a: z.number(), b: z.number() });
const invRampShape = z.object({ kind: z.literal("invRamp"), a: z.number(), b: z.number() });
const triangleShape = z.object({ kind: z.literal("triangle"), a: z.number(), b: z.number(), c: z.number() });
// superRefine: kształty zdegenerowane/odwrócone (np. ramp z a >= b, trójkąt z a > c)
// dają NaN lub bezsensowną funkcję przynależności — odrzucamy je już na wejściu.
export const termShapeSchema = z
  .discriminatedUnion("kind", [rampShape, invRampShape, triangleShape])
  .superRefine((s, ctx) => {
    if (s.kind === "ramp" || s.kind === "invRamp") {
      if (!(s.a < s.b)) {
        ctx.addIssue({ code: "custom", message: `${s.kind}: musi być a < b (a=${s.a}, b=${s.b})` });
      }
    } else {
      if (!(s.a <= s.b && s.b <= s.c && s.a < s.c)) {
        ctx.addIssue({
          code: "custom",
          message: `triangle: musi być a <= b <= c oraz a < c (a=${s.a}, b=${s.b}, c=${s.c})`,
        });
      }
    }
  });
export type TermShape = z.infer<typeof termShapeSchema>;

export const varParamsSchema = z
  .object({
    unit: z.string(),
    domain: z.tuple([z.number(), z.number()]),
    terms: z.record(z.string(), termShapeSchema),
  })
  .refine((v) => v.domain[0] < v.domain[1], {
    message: "domain[0] musi być mniejsze niż domain[1]",
    path: ["domain"],
  });
export type VarParams = z.infer<typeof varParamsSchema>;

/** Zmienna wejściowa: term o nazwie z prefiksem "nie_" kolidowałby z negacją dobudowywaną przez buildMamdani. */
export const inputVarParamsSchema = varParamsSchema.refine(
  (v) => Object.keys(v.terms).every((k) => !k.startsWith(NEG_PREFIX)),
  {
    message: `nazwa termu wejściowego nie może zaczynać się od prefiksu '${NEG_PREFIX}' (zarezerwowany dla negacji dobudowywanych przez buildMamdani)`,
    path: ["terms"],
  },
);

/** Zmienna wyjściowa W: terms musi być niepuste i ograniczone do etykiet LABELS (used as `Label[]` cast w mamdani.ts). */
export const outputVarParamsSchema = varParamsSchema.refine(
  (v) => {
    const keys = Object.keys(v.terms);
    return keys.length > 0 && keys.every((k) => (LABELS as readonly string[]).includes(k));
  },
  {
    message: `terms zmiennej wyjściowej musi być niepuste i zawierać wyłącznie etykiety z LABELS (${LABELS.join(", ")})`,
    path: ["terms"],
  },
);

export const INPUT_NAMES = ["S", "G", "L", "M"] as const;
export type InputName = (typeof INPUT_NAMES)[number];

/**
 * Reguła: koniunkcja (min) warunków `if`; term może być zanegowany prefiksem "nie_"
 * (np. "nie_plytka" = negate(plytka)) — negacje dobudowuje buildMamdani.
 */
export const ruleParamsSchema = z.object({
  id: z.string(),
  // z.record z kluczem-enumem w zod v4 wymaga wszystkich kluczy (rekord pełny);
  // reguły podają tylko podzbiór S/G/L/M, więc potrzebny jest partialRecord.
  // refine: pusty `if` dałby Math.min(...[]) === Infinity jako siłę reguły.
  if: z
    .partialRecord(z.enum(INPUT_NAMES), z.string())
    .refine((o) => Object.keys(o).length > 0, {
      message: "reguła musi mieć co najmniej jeden warunek",
    }),
  then: z.string(),
});
export type RuleParams = z.infer<typeof ruleParamsSchema>;

export const mamdaniParamsSchema = z.object({
  inputs: z.object({
    S: inputVarParamsSchema,
    G: inputVarParamsSchema,
    L: inputVarParamsSchema,
    M: inputVarParamsSchema,
  }),
  output: outputVarParamsSchema,
  rules: z.array(ruleParamsSchema).min(1),
  /** liczba próbek centroidu; górny limit chroni przed przypadkową eksplozją kosztu defuzyfikacji */
  samples: z.number().int().positive().max(10000),
});
export type MamdaniParams = z.infer<typeof mamdaniParamsSchema>;

const inv = (a: number, b: number): TermShape => ({ kind: "invRamp", a, b });
const tri = (a: number, b: number, c: number): TermShape => ({ kind: "triangle", a, b, c });
const ramp = (a: number, b: number): TermShape => ({ kind: "ramp", a, b });

/** Parametry FINALNE z implementacji referencyjnej (po dostrojeniu R4/R6/R11/R15). */
export const DEFAULT_MAMDANI_PARAMS: MamdaniParams = {
  inputs: {
    S: { unit: "%", domain: [0, 3], terms: { znikoma: inv(0.3, 0.65), umiarkowana: tri(0.5, 0.9, 1.4), duza: ramp(1.1, 1.8) } },
    G: { unit: "% wartości transakcji", domain: [0, 2], terms: { niski: inv(0.1, 0.3), umiarkowany: tri(0.2, 0.45, 0.8), zaporowy: ramp(0.6, 1.0) } },
    L: { unit: "mln USD", domain: [0, 100], terms: { plytka: inv(2, 8), srednia: tri(5, 20, 45), gleboka: ramp(35, 60) } },
    M: { unit: "pkt", domain: [0, 100], terms: { niskie: inv(20, 40), srednie: tri(30, 50, 70), wysokie: ramp(60, 80) } },
  },
  output: {
    unit: "pkt",
    domain: [0, 100],
    terms: { niewykonalna: inv(15, 30), ryzykowna: tri(25, 40, 55), wykonalna: tri(50, 65, 80), atrakcyjna: ramp(75, 90) },
  },
  rules: [
    // Reguły wetujące — warunki konieczne wykonalności
    { id: "R1", if: { S: "znikoma" }, then: "niewykonalna" },
    { id: "R2", if: { G: "zaporowy" }, then: "niewykonalna" },
    { id: "R3", if: { S: "umiarkowana", L: "plytka" }, then: "niewykonalna" },
    { id: "R4", if: { S: "umiarkowana", G: "umiarkowany", M: "nie_niskie" }, then: "niewykonalna" },
    // Spread umiarkowany
    { id: "R5", if: { S: "umiarkowana", G: "niski", L: "gleboka", M: "niskie" }, then: "wykonalna" },
    { id: "R6", if: { S: "umiarkowana", G: "niski", M: "srednie" }, then: "ryzykowna" },
    { id: "R7", if: { S: "umiarkowana", G: "niski", L: "srednia", M: "niskie" }, then: "wykonalna" },
    { id: "R8", if: { S: "umiarkowana", G: "niski", M: "wysokie" }, then: "ryzykowna" },
    { id: "R9", if: { S: "umiarkowana", G: "umiarkowany", L: "nie_plytka", M: "niskie" }, then: "ryzykowna" },
    // Spread duży
    { id: "R10", if: { S: "duza", G: "niski", L: "gleboka", M: "niskie" }, then: "atrakcyjna" },
    { id: "R11", if: { S: "duza", G: "niski", L: "nie_plytka", M: "srednie" }, then: "wykonalna" },
    { id: "R12", if: { S: "duza", G: "niski", L: "srednia", M: "niskie" }, then: "atrakcyjna" },
    { id: "R13", if: { S: "duza", G: "niski", M: "wysokie" }, then: "ryzykowna" },
    { id: "R14", if: { S: "duza", G: "umiarkowany", L: "nie_plytka", M: "niskie" }, then: "wykonalna" },
    { id: "R15", if: { S: "duza", G: "umiarkowany", M: "nie_niskie" }, then: "ryzykowna" },
    { id: "R16", if: { S: "duza", L: "plytka" }, then: "ryzykowna" },
  ],
  samples: 500,
};
