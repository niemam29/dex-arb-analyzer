/**
 * Rozmyta ocena wykonalności okazji arbitrażowych (Mamdani, @thi.ng/fuzzy).
 * AND = min, implikacja = min, agregacja = max, defuzyfikacja = centroid.
 * Logika 1:1 z referencyjną implementacją FIS; parametry zbiorów i reguł
 * pochodzą z MamdaniParams (JSON w scoring_models.params).
 *
 * Zbiory brzegowe jako ramp/invRamp (trapezoid() daje NaN przy zdegenerowanym
 * ramieniu). Warunki negowane ("nie_<term>") jako syntetyczne termy negate() —
 * konstruktor reguł biblioteki przyjmuje wyłącznie nazwy termów.
 */
import {
  and,
  centroidStrategy,
  defuzz,
  invRamp,
  negate,
  ramp,
  triangle,
  variable,
  type FuzzyFn,
  type LVar,
  type Rule as FuzzyRule,
} from "@thi.ng/fuzzy";
import {
  DEFAULT_MAMDANI_PARAMS,
  NEG_PREFIX,
  mamdaniParamsSchema,
  type InputName,
  type MamdaniParams,
  type TermShape,
  type VarParams,
} from "./mamdani.params.js";
import { LABELS, type Features, type Label, type ScoreResult, type ScoringModel } from "./types.js";

export type CrispInputs = Record<InputName, number>;

export interface RuleActivation {
  id: string;
  /** siła odpalenia: min ze stopni przynależności warunków */
  strength: number;
}

export interface InferenceResult {
  /** wartość po defuzyfikacji (0–100) */
  value: number;
  /** term wyjściowy o najwyższej przynależności dla value */
  label: Label;
  activations: RuleActivation[];
}

const shapeToFn = (s: TermShape): FuzzyFn =>
  s.kind === "ramp" ? ramp(s.a, s.b) : s.kind === "invRamp" ? invRamp(s.a, s.b) : triangle(s.a, s.b, s.c);

/** Zmienna lingwistyczna z termami z parametrów + negacje "nie_<term>" (tylko dla wejść). */
function buildVar(p: VarParams, withNegations: boolean): LVar<string> {
  const terms: Record<string, FuzzyFn> = {};
  for (const [name, shape] of Object.entries(p.terms)) {
    terms[name] = shapeToFn(shape);
    if (withNegations) terms[NEG_PREFIX + name] = negate(shapeToFn(shape));
  }
  return variable(p.domain, terms);
}

type Inputs = Record<InputName, LVar<string>>;
type Outputs = { W: LVar<string> };

export interface Mamdani {
  params: MamdaniParams;
  evaluate(crisp: CrispInputs): InferenceResult;
}

/**
 * Term wyjściowy o najwyższej przynależności dla `value` (remis -> pierwszy w kolejności
 * `outputTerms`). Wywołujący MUSI podać `outputTerms` w kolejności LABELS (types.ts) —
 * ta funkcja tylko iteruje, nie sortuje.
 */
function pickLabel(value: number, outputTerms: readonly Label[], outVar: LVar<string>): Label {
  let label = outputTerms[0]!;
  let best = -1;
  for (const t of outputTerms) {
    const m = outVar.terms[t]!(value);
    if (m > best) {
      best = m;
      label = t;
    }
  }
  return label;
}

/**
 * Siła odpalenia reguły (koniunkcja warunków `if`). Nie hardkodujemy Math.min: `rule.op`
 * to dokładnie ta sama funkcja (tnormMin dla `and()`), którą @thi.ng/fuzzy wpisuje w
 * regułę i której `defuzz()` używa wewnętrznie do łączenia warunków (rules.js/defuzz.js).
 * `defuzz()` liczy siłę reguły i od razu ją zużywa (przycina nią term wyjściowy) w jednej
 * pętli — nie zwraca osobno per-regułowych alf, więc nie da się jej odpytać wprost;
 * `rule.op` to jedyny publiczny fragment tej logiki, więc to on jest źródłem prawdy tutaj.
 */
function firingStrength(rule: FuzzyRule<Inputs, Outputs>, inputs: Inputs, crisp: CrispInputs): number {
  const degrees = Object.entries(rule.if).map(
    ([v, term]) => inputs[v as InputName].terms[term!]!(crisp[v as InputName]),
  );
  return degrees.reduce((a, b) => rule.op(a, b));
}

const defaultOutputVar = buildVar(DEFAULT_MAMDANI_PARAMS.output, false);
const defaultOutputTerms = LABELS.filter((l) => Object.hasOwn(DEFAULT_MAMDANI_PARAMS.output.terms, l));

/**
 * Etykieta wyjściowa W dla ostrej wartości `value` (0–100): term o najwyższej przynależności
 * wśród termów zmiennej wyjściowej `outputParams` (domyślnie `DEFAULT_MAMDANI_PARAMS.output`,
 * współdzielony i memoizowany, żeby nie budować `LVar` na każde wywołanie).
 *
 * Eksportowana, żeby `AnfisModel` (spec §5) etykietowało score = 100·sigmoid(z)
 * DOKŁADNIE tak samo jak `MamdaniModel` etykietuje wartość po defuzyfikacji — inaczej ten sam
 * wynik liczbowy mógłby dostać różne etykiety w zależności od modelu, co byłoby mylące na
 * dashboardzie porównującym oba modele.
 */
export function labelForScore(value: number, outputParams: VarParams = DEFAULT_MAMDANI_PARAMS.output): Label {
  if (outputParams === DEFAULT_MAMDANI_PARAMS.output) return pickLabel(value, defaultOutputTerms, defaultOutputVar);
  const outVar = buildVar(outputParams, false);
  const outputTerms = LABELS.filter((l) => Object.hasOwn(outputParams.terms, l));
  return pickLabel(value, outputTerms, outVar);
}

export function buildMamdani(params: unknown = DEFAULT_MAMDANI_PARAMS): Mamdani {
  const p = mamdaniParamsSchema.parse(params);
  const inputs = {
    S: buildVar(p.inputs.S, true),
    G: buildVar(p.inputs.G, true),
    L: buildVar(p.inputs.L, true),
    M: buildVar(p.inputs.M, true),
  } satisfies Inputs;
  const outputs: Outputs = { W: buildVar(p.output, false) };
  // Kolejność LABELS, NIE Object.keys(p.output.terms): jsonb Postgresa porządkuje klucze
  // obiektu wg (długość, bajty), więc te same parametry po round-tripie przez bazę miałyby
  // inną kolejność kluczy niż zdefiniowana w kodzie — zmieniałoby to rozstrzyganie remisów
  // przynależności (pickLabel) oraz etykietę fallbacku "żadna reguła się nie odpaliła".
  // `outputVarParamsSchema` (mamdani.params.ts) wymusza, że każdy klucz p.output.terms
  // należy do LABELS — po mamdaniParamsSchema.parse(params) powyżej ten filter jest bezpieczny.
  const outputTerms = LABELS.filter((l) => Object.hasOwn(p.output.terms, l));

  for (const r of p.rules) {
    for (const [v, term] of Object.entries(r.if)) {
      if (!Object.hasOwn(inputs[v as InputName].terms, term!))
        throw new Error(`Reguła ${r.id}: nieznany term '${term}' zmiennej ${v}`);
    }
    if (!Object.hasOwn(outputs.W.terms, r.then))
      throw new Error(`Reguła ${r.id}: nieznany term wyjściowy '${r.then}'`);
  }

  const rules: { id: string; rule: FuzzyRule<Inputs, Outputs> }[] = p.rules.map((r) => ({
    id: r.id,
    rule: and<Inputs, Outputs>(r.if, { W: r.then }),
  }));
  const fuzzyRules = rules.map((x) => x.rule);
  const strategy = centroidStrategy({ samples: p.samples });
  const [lo, hi] = outputs.W.domain;

  const evaluate = (crisp: CrispInputs): InferenceResult => {
    const activations = rules.map((x) => ({ id: x.id, strength: firingStrength(x.rule, inputs, crisp) }));
    // Fallback, gdy żadna reguła się nie odpaliła (wszystkie strength <= 0): defuzz()
    // biblioteki rzuciłby wtedy wyjątkiem. Wewnątrz (defuzz.js) buduje listę przyciętych
    // termów wyjściowych tylko dla reguł z alpha > 0 — `if (alpha)` w JS traktuje 0 jako
    // fałsz — po czym łączy je przez union(combine, ...termy). Przy pustej liście
    // union() -> compose() rzuca "no fuzzy sets given" (shapes.js, case 0 argumentów).
    // Zamiast tego zwracamy środek dziedziny W, a etykietę wyznaczamy z przynależności
    // w tym punkcie (ta sama logika co dla wyniku defuzyfikacji, patrz pickLabel).
    // Dla DEFAULT_MAMDANI_PARAMS ta ścieżka jest w praktyce nieosiągalna: R1/R2 są
    // wetujące (odpalają dla dowolnego S<0,65 / G w strefie "zaporowy"), a pozostałe
    // reguły pokrywają resztę przestrzeni S/G komplementarnymi parami termów (np.
    // niskie/nie_niskie) — zweryfikowano siatką >150 tys. punktów (patrz mamdani.test.ts).
    // Ścieżka jest realna dla dowolnego innego (np. niekompletnego) zestawu reguł z bazy.
    const value = activations.some((a) => a.strength > 0)
      ? defuzz(inputs, outputs, fuzzyRules, crisp, strategy).W!
      : (lo + hi) / 2;
    const label = pickLabel(value, outputTerms, outputs.W);
    return { value, label, activations };
  };

  return { params: p, evaluate };
}

const defaultEngine = buildMamdani();

/** Wnioskowanie dla ostrych wartości S/G/L/M (domyślne parametry referencyjne). */
export function evaluateArbitrage(crisp: CrispInputs, params?: unknown): InferenceResult {
  return (params !== undefined ? buildMamdani(params) : defaultEngine).evaluate(crisp);
}

/** Adapter do wspólnego interfejsu ScoringModel (spec §5). */
export function createMamdaniModel(params: unknown = DEFAULT_MAMDANI_PARAMS): ScoringModel {
  const engine = buildMamdani(params);
  return {
    kind: "mamdani",
    score(f: Features) {
      const r = engine.evaluate({ S: f.S, G: f.G, L: f.L, M: f.M });
      return { score: r.value, label: r.label, details: { activations: r.activations } };
    },
  };
}

/**
 * Wariant klasowy adaptera ScoringModel — udostępnia `MamdaniModel` jako klasę (nie tylko fabrykę).
 * Cienki alias nad `createMamdaniModel` — deleguje całą logikę, nie duplikuje jej.
 */
export class MamdaniModel implements ScoringModel {
  readonly kind = "mamdani" as const;
  private readonly model: ScoringModel;

  constructor(params: unknown = DEFAULT_MAMDANI_PARAMS) {
    this.model = createMamdaniModel(params);
  }

  score(f: Features): ScoreResult {
    return this.model.score(f);
  }
}
