/**
 * Przejście w przód ANFIS — Takagi–Sugeno rzędu 1 (spec §1.3). Pięć warstw:
 *  1. przynależności `mu_c` (Gauss z ramieniem, ew. `1-g` dla klauzuli negowanej)
 *  2. siła odpalenia reguły `w_i = ∏ mu_c` (iloczyn, nie min — różniczkowalny wszędzie,
 *     gradient trafia do każdej klauzuli, nie tylko do „najsłabszej"; przy inicjalizacji
 *     rankingi są bliskie temu, co dałoby `min`)
 *  3. normalizacja `w̄_i = w_i / (Σw_j + ε)`
 *  4. konsekwent liniowy `f_i = p_i·S' + q_i·G' + r_i·L' + s_i·M' + t_i` na cechach
 *     STANDARYZOWANYCH (przesłanki działają na cechach SUROWYCH — patrz standardize.ts)
 *  5. agregacja `z = Σ w̄_i·f_i`, wynik `y = sigmoid(z) ∈ (0,1)`; score modelu = 100·y
 */
import { labelForScore } from "../mamdani.js";
import type { Features, Label, ScoringModel } from "../types.js";
import { membership, membershipGrad } from "./gaussian.js";
import { anfisParamsSchema, VAR_ORDER, type AnfisParams } from "./init.js";
import { standardize } from "./standardize.js";

/** Zabezpieczenie mianownika normalizacji przed dzieleniem przez 0, gdy żadna reguła się nie odpala. */
const EPS = 1e-12;

/** y = 1/(1+e^-z) — logistyczna funkcja aktywacji wyjścia; wynik ∈ (0,1). */
export const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

export interface ForwardCache {
  /** cechy surowe, przycięte do dziedziny */
  x: number[];
  /** cechy standaryzowane (wejście konsekwentów) */
  xs: number[];
  /** [reguła][klauzula] — przynależność (po ew. negacji) */
  mu: number[][];
  /** [reguła] — siła odpalenia (iloczyn klauzul) */
  w: number[];
  /** Σw + ε */
  wSum: number;
  /** [reguła] — siła odpalenia znormalizowana */
  wBar: number[];
  /** [reguła] — konsekwent liniowy */
  f: number[];
  /** ważona suma konsekwentów (logit wyniku) */
  z: number;
  /** sigmoid(z) ∈ (0,1) */
  y: number;
}

/**
 * Przycina cechy do dziedziny każdej zmiennej `p.domains[j]` (tak samo jak Mamdani na
 * wejściu). Wartości niekończone/NaN (np. brak danych) trafiają na dolną granicę dziedziny.
 */
export function clampToDomain(p: AnfisParams, x: number[]): number[] {
  return x.map((v, j) => {
    const [lo, hi] = p.domains[j]!;
    return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
  });
}

/**
 * Sprawdza `p.features` przeciwko `VAR_ORDER` — `forward()` interpretuje
 * `xRaw[0..3]` pozycyjnie jako `[S,G,L,M]` (patrz `p.domains[j]`/`p.terms[j]` niżej), więc
 * `AnfisParams` z permutowaną/uszkodzoną kolejnością cech policzyłby wynik na pomieszanych
 * zmiennych bez żadnego błędu — cicho i błędnie. `anfisParamsSchema` (z.tuple literałów)
 * łapie to przy deserializacji, ale `forward()` bywa wołane też na ręcznie sklejonych
 * `AnfisParams` (np. `unflattenParams`, testy) — stąd druga, tania kontrola tutaj.
 */
function assertFeatureOrder(p: AnfisParams): void {
  const order = p.features;
  const ok = order?.length === VAR_ORDER.length && order.every((v, i) => v === VAR_ORDER[i]);
  if (!ok) {
    throw new Error(
      `forward: AnfisParams.features (${JSON.stringify(order)}) nie zgadza się z oczekiwaną kolejnością cech (${JSON.stringify(VAR_ORDER)})`,
    );
  }
}

/** Przejście w przód dla jednego wektora cech `xRaw = [S,G,L,M]` (jednostki naturalne). */
export function forward(p: AnfisParams, xRaw: number[]): ForwardCache {
  assertFeatureOrder(p);
  const x = clampToDomain(p, xRaw);
  const xs = standardize(x, p.standardizer);

  // Warstwa 1: przynależności (z ew. negacją klauzuli).
  const mu = p.rules.map((r) =>
    r.clauses.map((c) => {
      const g = membership(p.terms[c.varIdx]![c.termIdx]!, x[c.varIdx]!);
      return c.negate ? 1 - g : g;
    }),
  );

  // Warstwa 2: siła odpalenia = iloczyn przynależności klauzul reguły.
  const w = mu.map((m) => m.reduce((a, b) => a * b, 1));

  // Warstwa 3: normalizacja.
  const wSum = w.reduce((a, b) => a + b, 0) + EPS;
  const wBar = w.map((v) => v / wSum);

  // Warstwa 4: konsekwenty liniowe na cechach standaryzowanych.
  const f = p.consequents.map(([pc, qc, rc, sc, tc]) => pc! * xs[0]! + qc! * xs[1]! + rc! * xs[2]! + sc! * xs[3]! + tc!);

  // Warstwa 5: agregacja + sigmoid.
  const z = wBar.reduce((s, wb, i) => s + wb * f[i]!, 0);

  return { x, xs, mu, w, wSum, wBar, f, z, y: sigmoid(z) };
}

/** Skrót do `forward(p, xRaw).y` — wynik surowy ∈ (0,1) (score dla ScoringModel = 100·y). */
export function predict(p: AnfisParams, xRaw: number[]): number {
  return forward(p, xRaw).y;
}

/**
 * Ważona BCE (binarna entropia krzyżowa) dla jednej próbki (spec §1.4):
 * `L = -weight·[target·ln(y) + (1-target)·ln(1-y)]`. Wynik przycinany do (1e-12, 1-1e-12),
 * żeby uniknąć `-Infinity` przy y dokładnie 0/1 (zaokrąglenia liczb zmiennoprzecinkowych).
 */
export function bceLoss(y: number, target: 0 | 1, weight: number): number {
  const yc = Math.min(1 - 1e-12, Math.max(1e-12, y));
  return -weight * (target === 1 ? Math.log(yc) : Math.log(1 - yc));
}

/** Gradient o tym samym kształcie co `AnfisParams` (przesłanki + konsekwenty), akumulowany przez `backward`. */
export interface Grads {
  /** [var][term] */
  terms: { dMu: number; dSigma: number }[][];
  /** [rule][5] */
  consequents: number[][];
}

/** Gradient wyzerowany, tego samego kształtu co parametry `p`. */
export function zeroGrads(p: AnfisParams): Grads {
  return {
    terms: p.terms.map((ts) => ts.map(() => ({ dMu: 0, dSigma: 0 }))),
    consequents: p.consequents.map((c) => c.map(() => 0)),
  };
}

/**
 * Wsteczna propagacja ∂(weight·BCE)/∂θ dla jednej próbki (spec §1.4) — **dodaje** do `acc`
 * (nie zeruje go), żeby wywołujący mógł akumulować gradient całego minibatcha. `c` musi
 * pochodzić z `forward(p, x)` dla tego samego `p` (używa jego pamięci podręcznej: wagi,
 * konsekwenty, cechy standaryzowane/surowe).
 *
 * δ = ∂L/∂z = weight·(y - target)
 * konsekwenty reguły i: ∂L/∂[p_i,q_i,r_i,s_i,t_i] = δ·w̄_i·[S',G',L',M',1]
 * siła odpalenia reguły i: ∂L/∂w_i = δ·(f_i - z)/Σw   (pochodna ilorazu normalizacji)
 * klauzula c reguły i: ∂w_i/∂μ_c = ∏_{c'≠c} μ_{c'} (iloczyn pozostałych klauzul reguły)
 * term (j,k): akumuluje się z każdej klauzuli, która go używa: ∂L/∂w_i · ∂w_i/∂μ_c · s_c · ∂g/∂{μ,σ}
 * gdzie s_c = -1 dla klauzuli negowanej (μ_c = 1-g), inaczej +1.
 */
export function backward(p: AnfisParams, c: ForwardCache, target: 0 | 1, weight: number, acc: Grads): void {
  const delta = weight * (c.y - target);
  const xsExt = [c.xs[0]!, c.xs[1]!, c.xs[2]!, c.xs[3]!, 1];

  for (let i = 0; i < p.rules.length; i++) {
    // Konsekwenty (warstwa 4): działają na cechach standaryzowanych.
    const accCons = acc.consequents[i]!;
    for (let k = 0; k < 5; k++) accCons[k] = accCons[k]! + delta * c.wBar[i]! * xsExt[k]!;

    // Przesłanki (warstwy 1-2): ∂L/∂w_i, potem rozprowadzone na klauzule i termy.
    const dLdw = (delta * (c.f[i]! - c.z)) / c.wSum;
    const clauses = p.rules[i]!.clauses;
    const muRow = c.mu[i]!;
    for (let ci = 0; ci < clauses.length; ci++) {
      let others = 1;
      for (let cj = 0; cj < clauses.length; cj++) if (cj !== ci) others *= muRow[cj]!;
      const cl = clauses[ci]!;
      const { dMu, dSigma } = membershipGrad(p.terms[cl.varIdx]![cl.termIdx]!, c.x[cl.varIdx]!);
      const sign = cl.negate ? -1 : 1;
      const common = dLdw * others * sign;
      const termGrad = acc.terms[cl.varIdx]![cl.termIdx]!;
      termGrad.dMu += common * dMu;
      termGrad.dSigma += common * dSigma;
    }
  }
}

/** Spłaszcza parametry do wektora: [mu,sigma] dla każdego termu (kolejność [var][term]), potem konsekwenty [rule][5]. */
export function flattenParams(p: AnfisParams): number[] {
  return [...p.terms.flat().flatMap((t) => [t.mu, t.sigma]), ...p.consequents.flat()];
}

/** Spłaszcza gradient w tej samej kolejności co `flattenParams`. */
export function flattenGrads(p: AnfisParams, g: Grads): number[] {
  return [...g.terms.flat().flatMap((t) => [t.dMu, t.dSigma]), ...g.consequents.flat()];
}

/** Odtwarza `AnfisParams` z wektora `v` (kolejność jak `flattenParams`) — zwraca nowy obiekt, `p` bez zmian. */
export function unflattenParams(p: AnfisParams, v: number[]): AnfisParams {
  let k = 0;
  const terms = p.terms.map((ts) => ts.map((t) => ({ ...t, mu: v[k++]!, sigma: v[k++]! })));
  const consequents = p.consequents.map((c) => c.map(() => v[k++]!));
  return { ...p, terms, consequents };
}

/**
 * Adapter `AnfisParams` do wspólnego interfejsu `ScoringModel` (spec §5) — odpowiednik
 * `MamdaniModel`/`BaselineModel`, ale dla ANFIS. `score` = `100·sigmoid(z)` z `forward()`;
 * etykieta pochodzi z `labelForScore` (mamdani.ts) — TA SAMA funkcja przynależności termów
 * wyjściowych W, co `MamdaniModel`, żeby ten sam wynik liczbowy dostawał tę samą etykietę
 * niezależnie od modelu (patrz komentarz przy `labelForScore`).
 *
 * Konstruktor przyjmuje `unknown` (parametry z `scoring_models.params`, jsonb) i waliduje je
 * `anfisParamsSchema.parse` — tak samo jak `parseBaselineParams`/`mamdaniParamsSchema.parse`
 * w pozostałych modelach; rzuca, gdy kształt/spójność się nie zgadzają.
 */
export class AnfisModel implements ScoringModel {
  readonly kind = "anfis" as const;
  readonly params: AnfisParams;

  constructor(params: unknown) {
    this.params = anfisParamsSchema.parse(params);
  }

  /** Alias `new AnfisModel(json)` — symetryczny z `toJSON()` (spec §5: modele muszą się serializować do/z `scoring_models.params`). */
  static fromJSON(json: unknown): AnfisModel {
    return new AnfisModel(json);
  }

  /** `AnfisParams` gotowe do zapisania jako `scoring_models.params` (jsonb) — bez transformacji, `constructor`/`fromJSON` je z powrotem waliduje. */
  toJSON(): AnfisParams {
    return this.params;
  }

  score(f: Features): { score: number; label: Label; details: { firing: number[] } } {
    const c = forward(this.params, [f.S, f.G, f.L, f.M]);
    const score = 100 * c.y;
    return { score, label: labelForScore(score), details: { firing: c.w } };
  }
}
