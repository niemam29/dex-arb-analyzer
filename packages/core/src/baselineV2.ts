/**
 * Baseline v2 — „baseline skalibrowany": deterministyczny model bazowy z parametrami dobranymi
 * na etykietach weryfikacji (`profitable_consumed`), bez uczenia gradientowego i bez losowości.
 *
 * Motywacja (dane z bazy dev, okna 2–4): boty konsumujące okazje zużywają medianę ~153k gazu
 * (nie 220k jak zakłada baseline v1), ich rzeczywisty koszt gazu to ≈0,65–0,78 naszego szacunku,
 * część konsumpcji ma gas=0 (pakiety Flashbots), a ranking po zysku BRUTTO daje wyższe AUC niż
 * po netto v1. Baseline v2 parametryzuje więc koszt gazu (`gasUnits`, `gasPriceFactor`) i
 * opcjonalnie miesza z rangą `optTradeUsd`; parametry dobiera siatka (`calibrateBaselineV2`).
 *
 * Wejścia oceny (`BaselineV2Inputs`) pochodzą z `block_states`: `gross_profit_usd`,
 * `opt_trade_usd` oraz koszt gazu wg założeń v1 (`gasCostV1Usd` = `gross_profit_usd −
 * baseline_net_profit_usd`, czyli 220k·gwei·ETHUSD — kurs ETH nie jest zapisywany w
 * `block_states`, ale różnica brutto−netto v1 odtwarza go dokładnie; patrz `gasCostV1FromRow`).
 *
 * Ocena:
 *   net2  = gross − (gasUnits/arbGasRef)·gasPriceFactor·gasCostV1     (arbGasRef = gaz założony w v1, 220k)
 *   v     = (1−w)·sigmoid(net2/scale) + w·rank(optTradeUsd)         ∈ [0,1]   (0 gdy gross ≤ 0)
 *   score = odcinkowo-liniowe v -> [0,100] z v=threshold ↦ 50 (monotoniczne; score ≥ 50 ⇔ v ≥ threshold)
 * `scale` (odporny rozrzut net2 na zbiorze kalibracyjnym), `arbGasRef` i `optTradeQuantiles` (decyle
 * `optTradeUsd` zbioru kalibracyjnego, do rangi) są częścią parametrów, więc ocena jest
 * odtwarzalna z samego `scoring_models.params`.
 */
import { z } from "zod";
import { confusionMatrix, precisionRecallF1, rocAuc } from "./evaluation.js";
import { labelForScore } from "./mamdani.js";
import type { Features, ScoreResult, ScoringModel } from "./types.js";

export interface BaselineV2Params {
  /** gaz transakcji arbitrażowej [jednostki gazu] — v1 zakłada 220k, boty ~153k */
  gasUnits: number;
  /**
   * gaz założony w koszcie gazu v1 (`gasCostV1Usd` = arbGasRef·gwei·ETHUSD) [jednostki gazu] — mianownik
   * przeskalowania `gasUnits/arbGasRef`. Zapisywany w parametrach (a nie brany ze stałej `ARB_GAS`
   * w core), żeby ocena była odtwarzalna z samego `scoring_models.params`; job kalibracji ustawia go
   * ze stałej pipeline'u analizy (220k).
   */
  arbGasRef: number;
  /** mnożnik ceny gazu (0 = zysk brutto, 1 = pełna mediana gazu bloku) */
  gasPriceFactor: number;
  /** próg na `v` ∈ (0,1): v ≥ threshold ⇔ score ≥ 50 ⇔ „wykonalna" */
  threshold: number;
  /** waga rangi `optTradeUsd` w `v` (0 = wyłączone) */
  weightOptTrade: number;
  /** odporny rozrzut net2 [USD] na zbiorze kalibracyjnym (skala sigmoidy) */
  scale: number;
  /** decyle `optTradeUsd` zbioru kalibracyjnego (11 wartości, niemalejące) — do rangi */
  optTradeQuantiles: number[];
}

export const baselineV2ParamsSchema = z.object({
  gasUnits: z.number().positive(),
  arbGasRef: z.number().positive(),
  gasPriceFactor: z.number().min(0),
  threshold: z.number().gt(0).lt(1),
  weightOptTrade: z.number().min(0).max(1),
  scale: z.number().positive(),
  optTradeQuantiles: z.array(z.number()).min(2),
}) satisfies z.ZodType<BaselineV2Params>;

/** Parsuje `scoring_models.params` na `BaselineV2Params` — rzuca, gdy kształt się nie zgadza. */
export function parseBaselineV2Params(params: unknown): BaselineV2Params {
  return baselineV2ParamsSchema.parse(params);
}

/** Wejście oceny jednego bloku (z `block_states`). */
export interface BaselineV2Inputs {
  grossProfitUsd: number;
  /** koszt gazu wg założeń v1 (ARB_GAS=220k × mediana gazu × ETHUSD) [USD] */
  gasCostV1Usd: number;
  optTradeUsd: number;
}

/**
 * Koszt gazu v1 odtworzony z wiersza `block_states`: `baseline_net_profit_usd = gross −
 * ARB_GAS·gwei·ETHUSD` (`baselineNetProfitUsd` w core), więc różnica brutto − netto to dokładnie
 * koszt gazu v1. Dla bloków bez kierunku arbitrażu (gross = net = 0) daje 0. Ujemne wartości
 * (niemożliwe przy poprawnych danych) są obcinane do 0. NULL `baseline_net_profit_usd` z bazy jest
 * sprowadzany do 0 wcześniej, w `loadLabeledRows` (`@dex-arb/analysis`) — tu przychodzą już liczby.
 */
export function gasCostV1FromRow(grossProfitUsd: number, baselineNetProfitUsd: number): number {
  return Math.max(0, grossProfitUsd - baselineNetProfitUsd);
}

/** `Features` -> wejście oceny baseline v2 (brutto, koszt gazu v1 z różnicy brutto − netto v1, optTrade). */
export function featuresToBaselineV2Inputs(f: Pick<Features, "grossProfitUsd" | "netProfitUsd" | "optTradeUsd">): BaselineV2Inputs {
  return { grossProfitUsd: f.grossProfitUsd, gasCostV1Usd: gasCostV1FromRow(f.grossProfitUsd, f.netProfitUsd), optTradeUsd: f.optTradeUsd };
}

export const sigmoidV2 = (z: number): number => 1 / (1 + Math.exp(-z));

/** Zysk netto v2: brutto − (gasUnits/arbGasRef)·gasPriceFactor·kosztGazuV1. */
export function netProfitV2Usd(i: BaselineV2Inputs, p: Pick<BaselineV2Params, "gasUnits" | "arbGasRef" | "gasPriceFactor">): number {
  return i.grossProfitUsd - (p.gasUnits / p.arbGasRef) * p.gasPriceFactor * i.gasCostV1Usd;
}

/**
 * Ranga `x` względem decyli zbioru kalibracyjnego, ∈ [0,1] — interpolacja liniowa po
 * niemalejących kwantylach; remisy kwantyli (np. wiele zer) scalane, żeby nie dzielić przez 0.
 */
export function quantileRank(quantiles: number[], x: number): number {
  const n = quantiles.length;
  if (n === 0) return 0;
  if (!Number.isFinite(x) || x <= quantiles[0]!) return 0;
  if (x >= quantiles[n - 1]!) return 1;
  let i = 0;
  while (i + 1 < n && quantiles[i + 1]! <= x) i++;
  // teraz quantiles[i] <= x < quantiles[i+1]; jeśli równe (remis), przeskocz do końca remisu
  let j = i + 1;
  while (j + 1 < n && quantiles[j]! === quantiles[i]!) j++;
  const lo = quantiles[i]!;
  const hi = quantiles[j]!;
  const fLo = i / (n - 1);
  const fHi = j / (n - 1);
  return hi === lo ? fHi : fLo + ((fHi - fLo) * (x - lo)) / (hi - lo);
}

/**
 * Statystyka porządkująca `v` ∈ [0,1] (niezależna od `threshold`). Blok bez zysku brutto
 * (brak kierunku arbitrażu, `gross ≤ 0`) dostaje 0 — jak baseline v1 (`feasible` wymaga
 * `optTradeUsd > 0`); bez tej bramki `sigmoid(0) = 0,5` dawałoby tłu score ~40 („ryzykowna").
 */
export function baselineV2Statistic(i: BaselineV2Inputs, p: Omit<BaselineV2Params, "threshold">): number {
  if (!(i.grossProfitUsd > 0)) return 0;
  const net2 = netProfitV2Usd(i, p);
  const base = sigmoidV2(net2 / p.scale);
  if (p.weightOptTrade <= 0) return base;
  const r = quantileRank(p.optTradeQuantiles, i.optTradeUsd);
  return (1 - p.weightOptTrade) * base + p.weightOptTrade * r;
}

/** Odcinkowo-liniowe v -> score: [0,threshold] ↦ [0,50], [threshold,1] ↦ [50,100]. */
export function scoreFromStatistic(v: number, threshold: number): number {
  const s = v < threshold ? (50 * v) / threshold : 50 + (50 * (v - threshold)) / (1 - threshold);
  return Math.max(0, Math.min(100, s));
}

/** Model bazowy v2 — `ScoringModel`; `score(Features)` i `scoreInputs(BaselineV2Inputs)` liczą to samo. */
export class BaselineV2Model implements ScoringModel {
  readonly kind = "baseline_v2" as const;
  readonly params: BaselineV2Params;

  constructor(params: BaselineV2Params) {
    this.params = baselineV2ParamsSchema.parse(params);
  }

  /** Ocena z pól `block_states` (brutto, koszt gazu v1, optTrade). */
  scoreInputs(i: BaselineV2Inputs): ScoreResult {
    const net2 = netProfitV2Usd(i, this.params);
    const v = baselineV2Statistic(i, this.params);
    const score = scoreFromStatistic(v, this.params.threshold);
    return { score, label: labelForScore(score), details: { netProfitV2Usd: net2, v } };
  }

  /** `ScoringModel.score(Features)` — dokładnie `scoreInputs` (`Features` niesie brutto i netto v1, więc koszt gazu v1 = `gasCostV1FromRow`). */
  score(f: Features): ScoreResult {
    return this.scoreInputs(featuresToBaselineV2Inputs(f));
  }
}

// ---------------------------------------------------------------------------------------
// kalibracja (siatka) — funkcja czysta, deterministyczna
// ---------------------------------------------------------------------------------------

/** Wiersz kalibracyjny: zweryfikowana okazja o znanej etykiecie. */
export interface BaselineV2CalibrationRow extends BaselineV2Inputs {
  label: boolean;
}

export interface BaselineV2Grid {
  gasUnits: number[];
  gasPriceFactor: number[];
  weightOptTrade: number[];
}

/** Siatka z ustaleń projektowych: 2 × 5 × 3 = 30 kombinacji. */
export const DEFAULT_BASELINE_V2_GRID: BaselineV2Grid = {
  gasUnits: [150_000, 220_000],
  gasPriceFactor: [0, 0.25, 0.5, 0.75, 1],
  weightOptTrade: [0, 0.25, 0.5],
};

export interface BaselineV2GridPoint {
  gasUnits: number;
  gasPriceFactor: number;
  weightOptTrade: number;
  scale: number;
  threshold: number;
  auc: number;
  f1: number;
}

export interface BaselineV2Calibration {
  params: BaselineV2Params;
  /** metryki na zbiorze kalibracyjnym dla wybranego punktu (próg = `params.threshold`) */
  train: { n: number; positives: number; auc: number; f1: number; precision: number; recall: number; thresholdNetUsd: number | null };
  /** wszystkie punkty siatki (w kolejności przeszukiwania) — do wglądu w metrykach modelu */
  grid: BaselineV2GridPoint[];
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

/** Kwantyl typu 7 (interpolacja liniowa) posortowanej tablicy. */
function quantileSorted(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Decyle (11 wartości, q = 0, 0.1, …, 1) — niemalejące. */
export function deciles(values: number[]): number[] {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return [0, 1];
  return Array.from({ length: 11 }, (_, k) => quantileSorted(sorted, k / 10));
}

/**
 * Odporna skala rozrzutu: 1,4826·MAD; gdy 0 (połowa wartości identyczna) — odchylenie
 * standardowe; gdy i to 0 — 1 (sigmoida wtedy działa jak znak net2).
 */
export function robustScale(values: number[]): number {
  const xs = values.filter(Number.isFinite);
  if (xs.length === 0) return 1;
  const sorted = [...xs].sort((a, b) => a - b);
  const med = median(sorted);
  const mad = median(xs.map((x) => Math.abs(x - med)).sort((a, b) => a - b));
  if (mad > 0) return 1.4826 * mad;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return sd > 0 ? sd : 1;
}

/**
 * Próg na `v` maksymalizujący F1 (przeszukanie po unikalnych wartościach `v` malejąco;
 * predykcja = v ≥ cięcie). Zwracany próg to środek między wybranym cięciem a następną niższą
 * wartością `v` (albo samo cięcie, gdy niższej nie ma), obcięty do (0,1). Remisy F1: pierwsze
 * (najwyższe) cięcie — wybiera najbardziej konserwatywny próg.
 */
export function bestF1Threshold(v: number[], actual: boolean[]): { threshold: number; f1: number } {
  const idx = Array.from({ length: v.length }, (_, i) => i).sort((a, b) => v[b]! - v[a]!);
  const nPos = actual.filter(Boolean).length;
  let tp = 0;
  let fp = 0;
  let best = { threshold: 0.5, f1: -1, cutIdx: -1 };
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]!;
    if (actual[i]) tp++;
    else fp++;
    if (k + 1 < idx.length && v[idx[k + 1]!] === v[i]) continue; // remis — cięcie po całej grupie
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = nPos > 0 ? tp / nPos : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    if (f1 > best.f1) best = { threshold: v[i]!, f1, cutIdx: k };
  }
  if (best.cutIdx < 0) return { threshold: 0.5, f1: 0 };
  const cut = best.threshold;
  const next = best.cutIdx + 1 < idx.length ? v[idx[best.cutIdx + 1]!]! : cut;
  const mid = next < cut ? (cut + next) / 2 : cut;
  const eps = 1e-9;
  return { threshold: Math.min(1 - eps, Math.max(eps, mid)), f1: best.f1 };
}

/**
 * Przeszukanie siatki: dla każdej kombinacji (gasUnits, gasPriceFactor, weightOptTrade) liczy
 * `scale` (odporny rozrzut net2 na `rows`), decyle optTrade, statystykę `v`, AUC (Mann–Whitney)
 * i próg F1-optymalny; wybiera max AUC, remis → max F1, dalszy remis → pierwsza w kolejności
 * siatki. Deterministyczne (brak losowości), O(|siatka|·n log n). Rzuca, gdy `rows` nie zawiera
 * obu klas (AUC nieokreślone).
 */
export interface BaselineV2CalibrationOptions {
  /** gaz założony w koszcie gazu v1 wierszy (`BaselineV2Params.arbGasRef`) — job podaje `ARB_GAS` pipeline'u analizy */
  arbGasRef: number;
  grid?: BaselineV2Grid;
}

export function calibrateBaselineV2(rows: BaselineV2CalibrationRow[], opts: BaselineV2CalibrationOptions): BaselineV2Calibration {
  const { arbGasRef, grid = DEFAULT_BASELINE_V2_GRID } = opts;
  const actual = rows.map((r) => r.label);
  const nPos = actual.filter(Boolean).length;
  if (nPos === 0 || nPos === rows.length) {
    throw new Error(`calibrateBaselineV2: zbiór kalibracyjny musi zawierać obie klasy (n=${rows.length}, pozytywów=${nPos})`);
  }
  const optTradeQuantiles = deciles(rows.map((r) => r.optTradeUsd));

  const points: BaselineV2GridPoint[] = [];
  let best: { point: BaselineV2GridPoint; v: number[] } | null = null;
  for (const gasUnits of grid.gasUnits) {
    for (const gasPriceFactor of grid.gasPriceFactor) {
      const net2 = rows.map((r) => netProfitV2Usd(r, { gasUnits, arbGasRef, gasPriceFactor }));
      const scale = robustScale(net2);
      for (const weightOptTrade of grid.weightOptTrade) {
        const p = { gasUnits, arbGasRef, gasPriceFactor, weightOptTrade, scale, optTradeQuantiles };
        const v = rows.map((r) => baselineV2Statistic(r, p));
        const auc = rocAuc(v, actual);
        const { threshold, f1 } = bestF1Threshold(v, actual);
        const point: BaselineV2GridPoint = { gasUnits, gasPriceFactor, weightOptTrade, scale, threshold, auc, f1 };
        points.push(point);
        if (!best || auc > best.point.auc || (auc === best.point.auc && f1 > best.point.f1)) best = { point, v };
      }
    }
  }
  const { point, v } = best!;
  const params: BaselineV2Params = {
    gasUnits: point.gasUnits,
    arbGasRef,
    gasPriceFactor: point.gasPriceFactor,
    threshold: point.threshold,
    weightOptTrade: point.weightOptTrade,
    scale: point.scale,
    optTradeQuantiles,
  };
  const predicted = v.map((x) => x >= point.threshold);
  const { precision, recall, f1 } = precisionRecallF1(confusionMatrix(predicted, actual));
  // Próg w USD (tylko gdy ranga optTrade wyłączona — wtedy v = sigmoid(net2/scale) jest odwracalne).
  const thresholdNetUsd = point.weightOptTrade === 0 ? point.scale * Math.log(point.threshold / (1 - point.threshold)) : null;
  return {
    params,
    train: { n: rows.length, positives: nPos, auc: point.auc, f1, precision, recall, thresholdNetUsd },
    grid: points,
  };
}
