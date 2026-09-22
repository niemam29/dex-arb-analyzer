/**
 * Trening ANFIS: Adam na wszystkich parametrach, ważona BCE („balanced" wg klasy
 * `profitable_consumed`), walidacja stratyfikowana, early stopping, dolne ograniczenie σ
 * (spec §1.5). Cały pseudolosowy stan (podział, tasowanie minibatchy) pochodzi z jednego
 * `mulberry32(seed)`, więc ten sam seed + te same dane dają identyczne wytrenowane parametry.
 */
import type { AnfisParams } from "./init.js";
import { initFromMamdani } from "./init.js";
import { backward, bceLoss, flattenGrads, flattenParams, forward, unflattenParams, zeroGrads } from "./model.js";
import { mulberry32, shuffleInPlace } from "./random.js";
import { splitStratified, splitStratifiedGroups } from "./split.js";
import { fitStandardizer } from "./standardize.js";

export interface EpochStat {
  epoch: number;
  trainLoss: number;
  valLoss: number;
  lr: number;
}

export interface TrainOptions {
  /** Maksymalna liczba epok (spec §1.5: 200). */
  epochs?: number;
  /** Rozmiar minibatcha (spec §1.5: 256). */
  batchSize?: number;
  /** Krok Adama (spec §1.5: 0,01). */
  lr?: number;
  /** Liczba epok bez poprawy straty walidacyjnej przed zatrzymaniem (spec §1.5: 10). */
  patience?: number;
  /** Ułamek zbioru na walidację, stratyfikowany (spec §1.5: 0,2). */
  valFraction?: number;
  seed?: number;
  /** 'balanced' — waga klasy odwrotnie proporcjonalna do jej liczności (ograniczona do MAX_CLASS_WEIGHT_RATIO); 'none' — wagi 1/1. */
  classWeights?: "balanced" | "none";
  /** Parametry startowe zamiast `initFromMamdani()` (np. do dotrenowania / testów determinizmu). */
  init?: AnfisParams;
  /**
   * Klucze grupowe próbek (ta sama długość co `X`/`y`), np. `consumerTxHash`/klaster bloków —
   * patrz `@dex-arb/analysis` `computeGroupKeys`. Gdy podane, wewnętrzny podział train/val
   * (early stopping) jest ŚWIADOMY GRUP (`splitStratifiedGroups`): sąsiednie okazje potrafią
   * dzielić tę samą konsumującą transakcję i mieć niemal identyczne cechy/etykietę — podział
   * próbka-po-próbce (`splitStratified`) mógłby taką grupę rozdzielić między train i val, co
   * przecieka informację do walidacji (model „widziałby" podczas treningu niemal ten sam
   * przykład, który potem ocenia jako walidację) i zaniża stratę walidacyjną, psując kryterium
   * wczesnego zatrzymania. Gdy pominięte — zachowanie bez zmian (`splitStratified` po etykiecie).
   */
  groups?: (string | number)[];
  /**
   * Wywoływane po każdej epoce; może być asynchroniczne — trening CZEKA na jego zakończenie
   * (`await`), więc wywołujący może w nim np. zapisać postęp do bazy albo sprawdzić sygnał
   * przerwania (rzucenie wyjątku przerywa trening). Niezależnie od tego trening oddaje pętlę
   * zdarzeń raz na epokę (`setImmediate`), żeby proces nie był zablokowany na czas całego
   * uczenia. Nie wpływa na wynik: kolejność obliczeń i stan PRNG są takie same.
   */
  onEpoch?: (h: EpochStat) => void | Promise<void>;
}

export interface TrainResult {
  params: AnfisParams;
  history: EpochStat[];
  /** Numer epoki (1-based), z której pochodzą zwrócone `params` (najniższa strata walidacyjna). */
  bestEpoch: number;
  classWeights: { pos: number; neg: number };
  nTrain: number;
  nVal: number;
}

const DEFAULT_OPTIONS = {
  epochs: 200,
  batchSize: 256,
  lr: 0.01,
  patience: 10,
  valFraction: 0.2,
  seed: 42,
  classWeights: "balanced" as const,
};

/** Górny limit stosunku wag klas dla trybu 'balanced' — chroni przed eksplozją gradientu przy skrajnie niezbalansowanych danych (spec §1.5, „ograniczone np. ≤ 50"). */
export const MAX_CLASS_WEIGHT_RATIO = 50;

const ADAM_BETA1 = 0.9;
const ADAM_BETA2 = 0.999;
const ADAM_EPS = 1e-8;

/** Wagi klas 'balanced': neg=1, pos = min(N_neg/N_pos, MAX_CLASS_WEIGHT_RATIO) — spec §1.4/1.5. */
function computeClassWeights(y: (0 | 1)[], mode: "balanced" | "none"): { pos: number; neg: number } {
  if (mode === "none") return { pos: 1, neg: 1 };
  const nPos = y.reduce((s: number, v) => s + (v === 1 ? 1 : 0), 0);
  const nNeg = y.length - nPos;
  if (nPos === 0 || nNeg === 0) throw new Error("trainAnfis: zbiór uczący musi zawierać obie klasy (0 i 1)");
  return { pos: Math.min(nNeg / nPos, MAX_CLASS_WEIGHT_RATIO), neg: 1 };
}

/** Średnia ważona BCE po zbiorze indeksów `idx` (aktualne `params`). */
function meanLoss(params: AnfisParams, X: number[][], y: (0 | 1)[], idx: number[], weightOf: (t: 0 | 1) => number): number {
  if (idx.length === 0) return 0;
  const sum = idx.reduce((s, i) => s + bceLoss(forward(params, X[i]!).y, y[i]!, weightOf(y[i]!)), 0);
  return sum / idx.length;
}

/**
 * Trenuje ANFIS Adamem na (X,y). `X[i] = [S,G,L,M]` w jednostkach naturalnych (surowych),
 * `y[i] ∈ {0,1}` = etykieta `profitable_consumed`. Deterministyczne dla danego `seed` — cały
 * podział/tasowanie pochodzi z jednego `mulberry32(seed)` (spec §1.5). Asynchroniczne tylko po
 * to, żeby móc czekać na `onEpoch` i oddawać pętlę zdarzeń między epokami — same obliczenia są
 * synchroniczne i deterministyczne.
 */
export async function trainAnfis(X: number[][], y: (0 | 1)[], opts: TrainOptions = {}): Promise<TrainResult> {
  const { epochs, batchSize, lr, patience, valFraction, seed, classWeights, init, groups, onEpoch } = {
    ...DEFAULT_OPTIONS,
    ...opts,
  };
  if (X.length !== y.length || X.length === 0) throw new Error("trainAnfis: pusty lub niespójny zbiór uczący");
  if (groups && groups.length !== X.length) throw new Error("trainAnfis: groups musi mieć tę samą długość co X/y");

  const rng = mulberry32(seed);
  const { train, val } = groups ? splitStratifiedGroups(y, groups, valFraction, rng) : splitStratified(y, valFraction, rng);

  const cw = computeClassWeights(y, classWeights);
  const weightOf = (t: 0 | 1): number => (t === 1 ? cw.pos : cw.neg);

  // Standaryzator konsekwentów dopasowany WYŁĄCZNIE do zbioru treningowego (spec §1.1) — nie do
  // walidacyjnego/całości, żeby uniknąć wycieku informacji o rozkładzie walidacji do modelu.
  const base = init ?? initFromMamdani();
  let params: AnfisParams = { ...base, standardizer: fitStandardizer(train.map((i) => X[i]!)) };
  const sigmaMin = params.domains.map(([a, b]) => 0.01 * (b - a));

  // Adam — stan wektora spłaszczonych parametrów.
  const theta = flattenParams(params);
  const m = theta.map(() => 0);
  const v = theta.map(() => 0);
  let step = 0;

  const history: EpochStat[] = [];
  let best = { loss: Infinity, epoch: 0, theta: [...theta] };
  const order = [...train];

  for (let epoch = 1; epoch <= epochs; epoch++) {
    shuffleInPlace(order, rng);
    let trainLossSum = 0;

    for (let start = 0; start < order.length; start += batchSize) {
      const batch = order.slice(start, start + batchSize);
      const acc = zeroGrads(params);
      for (const i of batch) {
        const c = forward(params, X[i]!);
        const w = weightOf(y[i]!);
        trainLossSum += bceLoss(c.y, y[i]!, w);
        backward(params, c, y[i]!, w / batch.length, acc);
      }
      const g = flattenGrads(params, acc);
      step++;
      for (let k = 0; k < theta.length; k++) {
        m[k] = ADAM_BETA1 * m[k]! + (1 - ADAM_BETA1) * g[k]!;
        v[k] = ADAM_BETA2 * v[k]! + (1 - ADAM_BETA2) * g[k]! * g[k]!;
        const mHat = m[k]! / (1 - ADAM_BETA1 ** step);
        const vHat = v[k]! / (1 - ADAM_BETA2 ** step);
        theta[k] = theta[k]! - (lr * mHat) / (Math.sqrt(vHat) + ADAM_EPS);
      }
      // Dolne ograniczenie σ po każdym kroku (spec §1.5) — theta ma układ [mu,sigma] na term,
      // w kolejności [var][term] (patrz flattenParams); sigma leży na indeksach nieparzystych.
      let k = 1;
      for (let vi = 0; vi < params.terms.length; vi++) {
        for (let ti = 0; ti < params.terms[vi]!.length; ti++) {
          theta[k] = Math.max(theta[k]!, sigmaMin[vi]!);
          k += 2;
        }
      }
      params = unflattenParams(params, theta);
    }

    const stat: EpochStat = {
      epoch,
      trainLoss: trainLossSum / order.length,
      valLoss: val.length > 0 ? meanLoss(params, X, y, val, weightOf) : trainLossSum / order.length,
      lr,
    };
    history.push(stat);
    if (onEpoch) await onEpoch(stat);
    // Oddanie pętli zdarzeń raz na epokę — obliczenia są synchroniczne i CPU-bound, bez tego
    // żadne inne zadanie (timery, I/O, sygnały) nie wykonałoby się do końca treningu.
    await new Promise<void>((resolve) => setImmediate(resolve));

    if (stat.valLoss < best.loss - 1e-6) {
      best = { loss: stat.valLoss, epoch, theta: [...theta] };
    } else if (epoch - best.epoch >= patience) {
      break;
    }
  }

  return {
    params: unflattenParams(params, best.theta),
    history,
    bestEpoch: best.epoch,
    classWeights: cw,
    nTrain: train.length,
    nVal: val.length,
  };
}
