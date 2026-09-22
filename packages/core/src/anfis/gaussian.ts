/**
 * Funkcja przynależności Gaussa z ramionami (spec §1.2) — przesłanki ANFIS. Termy Mamdaniego
 * (`src/mamdani.ts`) mają trzy kształty: `triangle` (dwustronny), `invRamp` (plateau po lewej,
 * opada w prawo) i `ramp` (plateau po prawej, opada w lewo). Gaussa nie da się użyć wprost dla
 * ramion (Gauss zawsze opada w obie strony) — dlatego `leftShoulder`/`rightShoulder` „ucinają"
 * opadanie po stronie plateau, zachowując identyczny środek i szerokość połówkową co term
 * źródłowy (dopasowanie μ/σ liczy `init.ts`).
 */

/**
 * `full` — zwykły dwustronny Gauss (odpowiednik `triangle`).
 * `leftShoulder` — plateau=1 dla x≤μ, Gauss opadający w prawo (odpowiednik `invRamp`).
 * `rightShoulder` — plateau=1 dla x≥μ, Gauss opadający w lewo (odpowiednik `ramp`).
 */
export type GaussShape = "full" | "leftShoulder" | "rightShoulder";

export interface GaussTerm {
  mu: number;
  sigma: number;
  shape: GaussShape;
}

/** FWHM Gaussa = 2σ√(2 ln 2) — stała łącząca σ Gaussa z „szerokością połówkową" termu Mamdaniego. */
export const SQRT_2LN2 = Math.sqrt(2 * Math.log(2));

/** Dolny próg σ — chroni przed dzieleniem przez ~0 (zdegenerowany term o zerowej szerokości). */
const SIGMA_FLOOR = 1e-9;

const effectiveSigma = (sigma: number): number => Math.max(sigma, SIGMA_FLOOR);

/** Czy `x` leży na płaskim ramieniu termu (przynależność stała = 1, poza Gaussem). */
function onPlateau(t: GaussTerm, x: number): boolean {
  return (t.shape === "leftShoulder" && x <= t.mu) || (t.shape === "rightShoulder" && x >= t.mu);
}

/**
 * Stopień przynależności `x` do termu Gaussa (z ewentualnym ramieniem). Wynik ∈ (0,1] —
 * Gauss asymptotycznie dąży do 0, ale go nie osiąga; na plateau wynosi dokładnie 1.
 * Liczone numerycznie stabilnie: `exp(-((x-μ)/σ)² / 2)`.
 */
export function membership(t: GaussTerm, x: number): number {
  if (onPlateau(t, x)) return 1;
  const sigma = effectiveSigma(t.sigma);
  const z = (x - t.mu) / sigma;
  return Math.exp(-(z * z) / 2);
}

/**
 * Przynależność `g` wraz z pochodnymi analitycznymi ∂g/∂μ, ∂g/∂σ (spec §1.2, część gaussowska):
 * `∂g/∂μ = g·(x-μ)/σ²`, `∂g/∂σ = g·(x-μ)²/σ³`. Na plateau (gdzie g≡1, niezależnie od μ,σ w tym
 * punkcie) obie pochodne są dokładnie 0 — sprawdzane też numerycznie (różnica centralna) w
 * testach, poza granicą plateau.
 */
export function membershipGrad(t: GaussTerm, x: number): { g: number; dMu: number; dSigma: number } {
  if (onPlateau(t, x)) return { g: 1, dMu: 0, dSigma: 0 };
  const sigma = effectiveSigma(t.sigma);
  const d = x - t.mu;
  const s2 = sigma * sigma;
  const g = Math.exp(-(d * d) / (2 * s2));
  return { g, dMu: (g * d) / s2, dSigma: (g * d * d) / (s2 * sigma) };
}
