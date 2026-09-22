/**
 * Ewaluacja modeli oceny (spec §5): macierz pomyłek, precision/recall/F1,
 * AUC ROC (Mann–Whitney z remisami), histogram score. Moduł czysty — pracuje na
 * gotowych tablicach `{score, predicted, actual}`, bez zależności od bazy/typu modelu.
 * Etykieta prawdy (`profitable_consumed`) pojawi się dopiero w etapie 4; w etapie 2
 * `analysis` używa tego modułu wyłącznie do porównania baseline vs Mamdani (traktując
 * `baseline_feasible` jako pseudo-prawdę).
 */
import { mulberry32 } from "./anfis/random.js";

export interface ConfusionMatrix {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

export function confusionMatrix(predicted: boolean[], actual: boolean[]): ConfusionMatrix {
  if (predicted.length !== actual.length) throw new Error("confusionMatrix: różne długości");
  const cm = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (let i = 0; i < actual.length; i++) {
    if (predicted[i]) {
      if (actual[i]) cm.tp++;
      else cm.fp++;
    } else {
      if (actual[i]) cm.fn++;
      else cm.tn++;
    }
  }
  return cm;
}

const safeDiv = (a: number, b: number) => (b === 0 ? 0 : a / b);

export function precisionRecallF1(
  cm: ConfusionMatrix,
): { precision: number; recall: number; f1: number; accuracy: number } {
  const precision = safeDiv(cm.tp, cm.tp + cm.fp);
  const recall = safeDiv(cm.tp, cm.tp + cm.fn);
  const f1 = safeDiv(2 * precision * recall, precision + recall);
  const accuracy = safeDiv(cm.tp + cm.tn, cm.tp + cm.fp + cm.tn + cm.fn);
  return { precision, recall, f1, accuracy };
}

/** AUC ROC = P(score_pos > score_neg) + 0,5·P(remis) — statystyka Mann–Whitneya przez rangi. NaN gdy brak obu klas. */
export function rocAuc(scores: number[], actual: boolean[]): number {
  if (scores.length !== actual.length) throw new Error("rocAuc: różne długości");
  const n = scores.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[a]! - scores[b]!);
  const ranks = new Array<number>(n);
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && scores[idx[j + 1]!] === scores[idx[i]!]) j++;
    const r = (i + j) / 2 + 1; // średnia ranga dla remisów (1-based)
    for (let k = i; k <= j; k++) ranks[idx[k]!] = r;
    i = j + 1;
  }
  let nPos = 0;
  let rankSum = 0;
  for (let i = 0; i < n; i++) {
    if (actual[i]) {
      nPos++;
      rankSum += ranks[i]!;
    }
  }
  const nNeg = n - nPos;
  if (nPos === 0 || nNeg === 0) return NaN;
  return (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

export interface ScoreHistogram {
  edges: number[];
  counts: number[];
  /** Rozbicie `counts` wg klasy `actual` — obecne tylko, gdy `actual` podano. */
  positive?: number[];
  negative?: number[];
}

/**
 * Histogram score w `bins` kubełkach `[min,max)` (ostatni kubełek domknięty obustronnie).
 * Gdy podano `actual`, dodatkowo rozbija liczności na `positive`/`negative` (dashboard
 * porównujący rozkład score pozytywów/negatywów) — `counts[i] === positive[i] + negative[i]`.
 * Przeciążenie: gdy `actual` jest podane, zwracany typ statycznie gwarantuje obecność
 * `positive`/`negative` — wywołujący (np. `evaluateScores`) nie potrzebuje `!`/`as`, żeby po
 * nie sięgnąć.
 */
export function scoreHistogram(
  scores: number[],
  bins: number | undefined,
  min: number | undefined,
  max: number | undefined,
  actual: boolean[],
): ScoreHistogram & { positive: number[]; negative: number[] };
export function scoreHistogram(scores: number[], bins?: number, min?: number, max?: number, actual?: boolean[]): ScoreHistogram;
export function scoreHistogram(scores: number[], bins = 20, min = 0, max = 100, actual?: boolean[]): ScoreHistogram {
  if (actual && actual.length !== scores.length) throw new Error("scoreHistogram: `actual` musi mieć tę samą długość co `scores`");
  const width = (max - min) / bins;
  const edges = Array.from({ length: bins + 1 }, (_, i) => min + i * width);
  const counts = new Array<number>(bins).fill(0);
  const positive = actual ? new Array<number>(bins).fill(0) : undefined;
  const negative = actual ? new Array<number>(bins).fill(0) : undefined;
  scores.forEach((s, i) => {
    const b = Math.min(bins - 1, Math.max(0, Math.floor((s - min) / width)));
    counts[b]!++;
    if (actual) (actual[i] ? positive! : negative!)[b]!++;
  });
  return positive && negative ? { edges, counts, positive, negative } : { edges, counts };
}

/**
 * Punkty krzywej ROC (spec §5): próg przesuwany od +∞ w dół po malejących `scores`;
 * remisy (identyczny score) łączone w JEDEN punkt (bez tego pole pod trapezami krzywej —
 * patrz test `trapezoid(rocCurve) ≈ rocAuc` — nie zgadzałoby się z `rocAuc`, który liczy
 * remisy przez uśrednione rangi). Monotoniczna niemalejąco w obu współrzędnych, zaczyna się
 * w (0,0) (próg = +∞, nic nie sklasyfikowane jako pozytyw) i kończy w (1,1) (próg = -∞).
 */
export function rocCurve(scores: number[], actual: boolean[]): { fpr: number[]; tpr: number[]; thresholds: number[] } {
  if (scores.length !== actual.length) throw new Error("rocCurve: różne długości");
  const n = scores.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[b]! - scores[a]!);
  const nPos = actual.filter(Boolean).length;
  const nNeg = n - nPos;
  const fpr = [0];
  const tpr = [0];
  const thresholds = [Infinity];
  let tp = 0;
  let fp = 0;
  for (let k = 0; k < n; k++) {
    const i = idx[k]!;
    if (actual[i]) tp++;
    else fp++;
    // Kolejna wartość jest identyczna (remis) -> nie emitujemy punktu pośredniego, dociągamy licznik dalej.
    if (k + 1 < n && scores[idx[k + 1]!] === scores[i]) continue;
    fpr.push(nNeg ? fp / nNeg : 0);
    tpr.push(nPos ? tp / nPos : 0);
    thresholds.push(scores[i]!);
  }
  return { fpr, tpr, thresholds };
}

export interface EvaluationSummary {
  n: number;
  positives: number;
  cm: ConfusionMatrix;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  auc: number;
  /** `evaluateScores` zawsze przekazuje `actual` do `scoreHistogram`, więc `positive`/`negative` są tu zawsze obecne (nie tylko `edges`/`counts`). */
  histogram: ScoreHistogram & { positive: number[]; negative: number[] };
}

export function evaluateScores(scores: number[], predicted: boolean[], actual: boolean[]): EvaluationSummary {
  const cm = confusionMatrix(predicted, actual);
  return {
    n: actual.length,
    positives: actual.filter(Boolean).length,
    cm,
    ...precisionRecallF1(cm),
    auc: rocAuc(scores, actual),
    // Rozbicie histogramu na pozytywy/negatywy (dashboard porównujący rozkład score obu klas).
    histogram: scoreHistogram(scores, 20, 0, 100, actual),
  };
}

/** Kwantyl typu 7 (interpolacja liniowa) posortowanej tablicy. */
function quantileSorted(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export interface BootstrapOptions {
  /** liczba prób bootstrapowych (domyślnie 1000) */
  n?: number;
  /** seed `mulberry32` — ten sam seed ⇒ identyczny przedział (domyślnie 42) */
  seed?: number;
}

/**
 * 95 % przedział ufności AUC — bootstrap STRATYFIKOWANY po klasie: w każdej próbie losujemy ze
 * zwracaniem `nPos` pozytywów spośród pozytywów i `nNeg` negatywów spośród negatywów (liczności
 * klas zachowane, więc przy n_pos = 7 żadna próba nie traci klasy). Percentyle 2,5 / 97,5.
 * `null`, gdy brak jednej z klas (AUC nieokreślone).
 */
export function bootstrapAucCi(scores: number[], actual: boolean[], opts: BootstrapOptions = {}): [number, number] | null {
  if (scores.length !== actual.length) throw new Error("bootstrapAucCi: różne długości");
  const { n = 1000, seed = 42 } = opts;
  const pos: number[] = [];
  const neg: number[] = [];
  actual.forEach((a, i) => (a ? pos : neg).push(scores[i]!));
  if (pos.length === 0 || neg.length === 0) return null;
  const rng = mulberry32(seed);
  const sample = (from: number[]): number[] => from.map(() => from[Math.floor(rng() * from.length)]!);
  const aucs: number[] = [];
  const actualBoot = [...pos.map(() => true), ...neg.map(() => false)];
  for (let i = 0; i < n; i++) {
    aucs.push(rocAuc([...sample(pos), ...sample(neg)], actualBoot));
  }
  aucs.sort((a, b) => a - b);
  return [quantileSorted(aucs, 0.025), quantileSorted(aucs, 0.975)];
}

/**
 * Average precision (PR-AUC z interpolacją krokową): próg przesuwany po malejących score, remisy
 * scalone w jeden punkt (jak w `rocCurve`); AP = Σ (R_k − R_{k−1}) · P_k. Właściwa metryka przy
 * silnie niezbalansowanych klasach (1–12 % pozytywów w tych danych). NaN bez pozytywów.
 */
export function averagePrecision(scores: number[], actual: boolean[]): number {
  if (scores.length !== actual.length) throw new Error("averagePrecision: różne długości");
  const nPos = actual.filter(Boolean).length;
  if (nPos === 0) return NaN;
  const idx = Array.from({ length: scores.length }, (_, i) => i).sort((a, b) => scores[b]! - scores[a]!);
  let tp = 0;
  let fp = 0;
  let prevRecall = 0;
  let ap = 0;
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]!;
    if (actual[i]) tp++;
    else fp++;
    if (k + 1 < idx.length && scores[idx[k + 1]!] === scores[i]) continue;
    const recall = tp / nPos;
    const precision = tp / (tp + fp);
    ap += (recall - prevRecall) * precision;
    prevRecall = recall;
  }
  return ap;
}

/**
 * Próg na skali score maksymalizujący F1 (predykcja = score ≥ próg). Przeszukanie po unikalnych
 * wartościach score malejąco; zwracany próg to środek między wybranym cięciem a następną niższą
 * wartością (albo samo cięcie, gdy niższej nie ma). Remis F1 → pierwsze (najwyższe) cięcie.
 * Ten sam sposób doboru progu jest stosowany dla każdego modelu osobno na jego oknach
 * treningowych, żeby porównanie F1 między modelami miało wspólne kryterium.
 */
export function thresholdOptF1(scores: number[], actual: boolean[]): { threshold: number; f1: number } {
  if (scores.length !== actual.length) throw new Error("thresholdOptF1: różne długości");
  const idx = Array.from({ length: scores.length }, (_, i) => i).sort((a, b) => scores[b]! - scores[a]!);
  const nPos = actual.filter(Boolean).length;
  let tp = 0;
  let fp = 0;
  let best = { cut: NaN, f1: -1, k: -1 };
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]!;
    if (actual[i]) tp++;
    else fp++;
    if (k + 1 < idx.length && scores[idx[k + 1]!] === scores[i]) continue;
    const precision = tp / (tp + fp);
    const recall = nPos > 0 ? tp / nPos : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    if (f1 > best.f1) best = { cut: scores[i]!, f1, k };
  }
  if (best.k < 0) return { threshold: 0, f1: 0 };
  const next = best.k + 1 < idx.length ? scores[idx[best.k + 1]!]! : best.cut;
  return { threshold: next < best.cut ? (best.cut + next) / 2 : best.cut, f1: best.f1 };
}
