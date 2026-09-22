/**
 * Inicjalizacja przesłanek i konsekwentów ANFIS z 16 reguł Mamdaniego (spec §1.2, §1.6).
 * Źródłem prawdy o termach/regułach jest `DEFAULT_MAMDANI_PARAMS` (mamdani.params.ts) —
 * ten sam obiekt, którego używa `buildMamdani` — więc liczby nie są duplikowane.
 *
 * Term Mamdaniego → Gauss z ramieniem (ten sam środek i szerokość połówkowa — patrz
 * `gaussFromTerm`):
 *  - `triangle(a,b,c)`  → mu=b,  sigma=(c-a)/(4·√(2 ln 2)), shape="full"
 *  - `invRamp(a,b)`     → mu=a,  sigma=(b-a)/(2·√(2 ln 2)), shape="leftShoulder"
 *  - `ramp(a,b)`        → mu=b,  sigma=(b-a)/(2·√(2 ln 2)), shape="rightShoulder"
 *
 * Negacja reguły ("nie_<term>", tak jak w `buildMamdani`/NEG_PREFIX) nie tworzy osobnego
 * termu Gaussa — klauzula reguły dostaje flagę `negate` i współdzieli (mu, sigma) z termem
 * bazowym; przynależność liczona jest jako `1 - g(x)` (patrz `model.ts`).
 *
 * Konsekwenty startowe (Takagi–Sugeno rzędu 1): p=q=r=s=0, t = logit(center/100), gdzie
 * `center` to punkt pełnej przynależności termu wyjściowego W przypisanego regule — liczony
 * tym samym `gaussFromTerm(...).mu`, co przesłanki, więc nie trzeba osobno hardkodować
 * 15/40/65/90. Wtedy z = ważona średnia logitów, a y = sigmoid(z) jest „miękkim centroidem”
 * bliskim wynikowi Mamdaniego jeszcze przed treningiem (test rankingu w model.ts).
 */
import { z } from "zod";
import { DEFAULT_MAMDANI_PARAMS, NEG_PREFIX, type MamdaniParams, type TermShape } from "../mamdani.params.js";
import { LABELS, type Label } from "../types.js";
import { SQRT_2LN2, type GaussShape, type GaussTerm } from "./gaussian.js";
import type { Standardizer } from "./standardize.js";

export type VarName = "S" | "G" | "L" | "M";
// `as const` (nie `: readonly VarName[]`) — zachowuje literalny typ krotki `readonly
// ["S","G","L","M"]`, żeby `AnfisParams.features` mogło go użyć wprost
// jako źródło prawdy, zamiast duplikować cztery literały osobno.
export const VAR_ORDER = ["S", "G", "L", "M"] as const;

export interface Clause {
  varIdx: number;
  termIdx: number;
  negate: boolean;
}

export interface AnfisRule {
  id: string;
  clauses: Clause[];
  then: Label;
}

export interface AnfisParams {
  version: 1;
  /**
   * Kolejność cech S/G/L/M — MUSI się zgadzać z `VAR_ORDER`, w tej
   * samej kolejności co `domains`/`termNames`/`terms`. Zapisywana i walidowana jawnie (nie
   * tylko zakładana przez kod), żeby zdeserializowany/zbudowany-ręcznie model z permutowaną
   * kolejnością cech nie mieszał S z G itd. w środku `forward()` — `forward()` sprawdza to
   * (`assertFeatureOrder`), zamiast cicho liczyć na złej cesze.
   */
  features: readonly ["S", "G", "L", "M"];
  /** [var] — ta sama kolejność co VAR_ORDER */
  domains: [number, number][];
  /** [var][term] */
  termNames: string[][];
  /** [var][term] */
  terms: GaussTerm[][];
  rules: AnfisRule[];
  /** [rule][5] = p,q,r,s,t (konsekwent liniowy Takagi–Sugeno na cechach standaryzowanych) */
  consequents: number[][];
  standardizer: Standardizer;
  /** Metadane treningu (opcjonalne — brak dla `initFromMamdani()` przed treningiem). */
  meta?: { trainedAt?: string | undefined; seed?: number | undefined } | undefined;
}

const gaussShapeSchema = z.enum(["full", "leftShoulder", "rightShoulder"]) satisfies z.ZodType<GaussShape>;
// mu: skończone (przycięcie do dziedziny w clampToDomain zakłada realne granice, NaN/±Inf by
// je popsuł); sigma: dodatnie — sigma<=0 daje w membership() dzielenie
// przez ~0 (SIGMA_FLOOR chroni tylko przed ROWNYM zeru, nie przed ujemną wartością, która
// odwróciłaby znak wykładnika Gaussa i dałaby przynależność >1 zamiast opadającej).
const gaussTermSchema = z.object({
  mu: z.number().finite(),
  sigma: z.number().positive(),
  shape: gaussShapeSchema,
}) satisfies z.ZodType<GaussTerm>;
const clauseSchema = z.object({
  varIdx: z.number().int(),
  termIdx: z.number().int(),
  negate: z.boolean(),
}) satisfies z.ZodType<Clause>;
const anfisRuleSchema = z.object({
  id: z.string(),
  clauses: z.array(clauseSchema).min(1),
  then: z.enum(LABELS),
}) satisfies z.ZodType<AnfisRule>;
// std: dodatnie — standardize() dzieli przez std; 0 daje Infinity/NaN,
// ujemne wywraca znak cechy standaryzowanej (fitStandardizer() sam nigdy nie zwraca ujemnych
// wartości — to zabezpieczenie przeciwko ręcznie sklejonym/uszkodzonym parametrom z jsonb).
const standardizerSchema = z.object({
  mean: z.array(z.number()),
  std: z.array(z.number().positive()),
}) satisfies z.ZodType<Standardizer>;

// Krotka literałów (nie z.enum/z.array) — pozycja w tablicy MUSI być S,G,L,M w tej kolejności;
// z.tuple z literałami odrzuca permutacje na etapie parsowania (np. ["G","S","L","M"] nie
// przejdzie, bo pozycja 0 wymaga dokładnie "S"), bez potrzeby osobnego superRefine.
const featureOrderSchema = z.tuple([z.literal("S"), z.literal("G"), z.literal("L"), z.literal("M")]);

/**
 * Walidacja `AnfisParams` wczytanych z `scoring_models.params` (jsonb, więc `unknown` na
 * wejściu — patrz `baselineParamsSchema`/`mamdaniParamsSchema` po ten sam wzorzec). Poza
 * kształtem sprawdza spójność, której sam typ TS nie wymusza: liczbę zmiennych (4 = S,G,L,M),
 * `consequents.length === rules.length`, długość każdego konsekwentu (5 = p,q,r,s,t) oraz to,
 * że `varIdx`/`termIdx` każdej klauzuli wskazują na istniejący term w `terms`. `.strict()`
 * odrzuca nieznane klucze na najwyższym poziomie — literówka/niezamierzone
 * pole w zapisanych `scoring_models.params` ujawnia się od razu przy wczytaniu, nie ciszej
 * (pole po prostu zignorowane) głęboko w modelu.
 */
export const anfisParamsSchema = z
  .object({
    version: z.literal(1),
    features: featureOrderSchema,
    domains: z.array(z.tuple([z.number(), z.number()])),
    termNames: z.array(z.array(z.string())),
    terms: z.array(z.array(gaussTermSchema)),
    rules: z.array(anfisRuleSchema).min(1),
    consequents: z.array(z.array(z.number())),
    standardizer: standardizerSchema,
    meta: z.object({ trainedAt: z.string().optional(), seed: z.number().optional() }).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const nVars = 4;
    if (p.domains.length !== nVars) ctx.addIssue({ code: "custom", message: `domains musi mieć ${nVars} elementy (S,G,L,M)`, path: ["domains"] });
    if (p.termNames.length !== nVars) ctx.addIssue({ code: "custom", message: `termNames musi mieć ${nVars} elementy`, path: ["termNames"] });
    if (p.terms.length !== nVars) ctx.addIssue({ code: "custom", message: `terms musi mieć ${nVars} elementy`, path: ["terms"] });
    if (p.standardizer.mean.length !== nVars || p.standardizer.std.length !== nVars)
      ctx.addIssue({ code: "custom", message: `standardizer.mean/std musi mieć długość ${nVars}`, path: ["standardizer"] });
    if (p.consequents.length !== p.rules.length)
      ctx.addIssue({ code: "custom", message: "consequents.length musi równać się rules.length", path: ["consequents"] });
    p.consequents.forEach((c, i) => {
      if (c.length !== 5)
        ctx.addIssue({ code: "custom", message: `consequents[${i}] musi mieć długość 5 (p,q,r,s,t)`, path: ["consequents", i] });
    });
    p.rules.forEach((r, i) => {
      r.clauses.forEach((cl, j) => {
        const inRange = cl.varIdx >= 0 && cl.varIdx < p.terms.length && cl.termIdx >= 0 && cl.termIdx < (p.terms[cl.varIdx]?.length ?? 0);
        if (!inRange)
          ctx.addIssue({ code: "custom", message: `reguła ${r.id}: klauzula ${j} wskazuje poza zakres terms`, path: ["rules", i, "clauses", j] });
      });
    });
  }) satisfies z.ZodType<AnfisParams>;

/** Parsuje `scoring_models.params` na `AnfisParams` — rzuca, gdy kształt/spójność się nie zgadzają. */
export function parseAnfisParams(params: unknown): AnfisParams {
  return anfisParamsSchema.parse(params);
}

/** Gauss o tym samym środku i szerokości połówkowej co term Mamdaniego (spec §1.2). */
export function gaussFromTerm(spec: TermShape): GaussTerm {
  switch (spec.kind) {
    case "triangle":
      return { mu: spec.b, sigma: (spec.c - spec.a) / (4 * SQRT_2LN2), shape: "full" };
    case "invRamp":
      return { mu: spec.a, sigma: (spec.b - spec.a) / (2 * SQRT_2LN2), shape: "leftShoulder" };
    case "ramp":
      return { mu: spec.b, sigma: (spec.b - spec.a) / (2 * SQRT_2LN2), shape: "rightShoulder" };
  }
}

/** logit(p) = ln(p/(1-p)) — odwrotność sigmoidy; p ∈ (0,1). */
const logit = (p: number): number => Math.log(p / (1 - p));

/**
 * Buduje `AnfisParams` z parametrów Mamdaniego (domyślnie `DEFAULT_MAMDANI_PARAMS`): przesłanki
 * = Gaussy dopasowane do termów wejściowych S/G/L/M, reguły (z klauzulami negowanymi jako
 * flaga, nie osobnym termem), konsekwenty = "miękki centroid" reguł Mamdaniego (spec §1.6),
 * standaryzator startowy tożsamościowy (mean=0, std=1) — dopóki nie jest dopasowany do zbioru
 * treningowego. Parametr `mamdaniParams` jest opcjonalny (dla testowalności
 * defensywnego sprawdzenia niżej i ew. przyszłej rekalibracji reguł Mamdaniego bez zmiany kodu)
 * — wszystkie dotychczasowe wywołania używają wartości domyślnej.
 */
export function initFromMamdani(mamdaniParams: MamdaniParams = DEFAULT_MAMDANI_PARAMS): AnfisParams {
  const p = mamdaniParams;

  const termNames = VAR_ORDER.map((v) => Object.keys(p.inputs[v].terms));
  const terms = VAR_ORDER.map((v) => Object.values(p.inputs[v].terms).map(gaussFromTerm));

  const rules: AnfisRule[] = p.rules.map((r) => {
    // Defensywne sprawdzenie: `r.then` pochodzi z MamdaniParams (walidowane tylko przeciwko
    // outputVarParamsSchema, czyli kluczom `output.terms` — te MUSZĄ należeć do LABELS, ale
    // reguła i tak mogłaby (przy ręcznie sklejonych/nietypowych parametrach spoza schematu)
    // wskazywać term spoza LABELS). Bez tej kontroli `r.then as Label` przepuściłby dowolny
    // string dalej jako rzekomy `Label`, a błąd ujawniłby się dopiero głęboko w AnfisModel
    // (np. przy liczeniu `outputCenters[r.then]` -> `logit(NaN/100)` -> ciche NaN w konsekwencie).
    if (!(LABELS as readonly string[]).includes(r.then)) {
      throw new Error(`initFromMamdani: nieznana etykieta wyjściowa '${r.then}' reguły ${r.id} (oczekiwano jednej z: ${LABELS.join(", ")})`);
    }
    return {
      id: r.id,
      then: r.then as Label,
      clauses: (Object.entries(r.if) as [VarName, string][]).map(([v, term]) => {
        const varIdx = VAR_ORDER.indexOf(v);
        const negate = term.startsWith(NEG_PREFIX);
        const base = negate ? term.slice(NEG_PREFIX.length) : term;
        const termIdx = termNames[varIdx]!.indexOf(base);
        if (termIdx < 0) throw new Error(`initFromMamdani: nieznany term '${term}' zmiennej ${v} (reguła ${r.id})`);
        return { varIdx, termIdx, negate };
      }),
    };
  });

  // Środek termu wyjściowego W = punkt pełnej przynależności, liczony tak samo jak dla
  // przesłanek (gaussFromTerm(...).mu) — dla DEFAULT_MAMDANI_PARAMS daje dokładnie 15/40/65/90.
  const outputCenters = Object.fromEntries(
    LABELS.map((l) => [l, gaussFromTerm(p.output.terms[l]!).mu]),
  ) as Record<Label, number>;

  const consequents = rules.map((r) => [0, 0, 0, 0, logit(outputCenters[r.then] / 100)]);

  return {
    version: 1,
    features: VAR_ORDER,
    domains: VAR_ORDER.map((v) => [...p.inputs[v].domain] as [number, number]),
    termNames,
    terms,
    rules,
    consequents,
    standardizer: { mean: [0, 0, 0, 0], std: [1, 1, 1, 1] },
  };
}
