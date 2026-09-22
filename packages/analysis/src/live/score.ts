/**
 * Cechy S/G/L/M i ocena 4 modeli dla jednej pary z próbki na żywo (spec §3–§4).
 * S/G/L = `computeRawFeatures` z core (te same obcięcia co w trybie historycznym). M różni się
 * WYŁĄCZNIE źródłem percentyli: zamiast całego okna — krocząca historia próbek z bufora (ostatnia
 * godzina); poniżej LIVE_M_MIN_HISTORY próbek M = LIVE_M_NEUTRAL (percentyl na pustej tablicy to NaN).
 * Baseline v1 jak `scoreRows` (modelScores.ts): `BaselineModel.score(Features)`; Mamdani przez
 * `evaluateArbitrage` (domyślne parametry referencyjne); baseline v2 / ANFIS z `scoring_models.params`.
 */
import {
  BaselineModel, computeRawFeatures, evaluateArbitrage, type AnfisModel, type BaselineV2Model, type Features,
} from "@dex-arb/core";
import { LIVE_M_MIN_HISTORY, LIVE_M_NEUTRAL, type LiveScoresDto } from "@dex-arb/shared";
import type { LivePairSample } from "./sample.js";

/** Historia (nieposortowana) wartości wchodzących w percentyle M. */
export interface LiveHistory {
  swapsPerBlock: number[];
  gasGwei: number[];
}

export function liveFeatures(p: LivePairSample, gasGwei: number, hist: LiveHistory): Features {
  const enough = hist.swapsPerBlock.length >= LIVE_M_MIN_HISTORY && hist.gasGwei.length >= LIVE_M_MIN_HISTORY;
  const pct = enough
    ? { sortedSwapCounts: [...hist.swapsPerBlock].sort((a, b) => a - b), sortedGasGwei: [...hist.gasGwei].sort((a, b) => a - b) }
    : { sortedSwapCounts: [0], sortedGasGwei: [0] };
  const raw = computeRawFeatures(
    { spreadPct: p.spreadPct, tvlMinUsd: p.tvlMinUsd, gasPriceGwei: gasGwei, ethUsd: p.ethUsd, swapsInBlock: p.swapsPerBlock },
    pct,
  );
  return {
    S: raw.S,
    G: raw.G,
    L: raw.L,
    M: enough ? raw.M : LIVE_M_NEUTRAL,
    netProfitUsd: p.netProfitUsd,
    grossProfitUsd: p.grossProfitUsd,
    optTradeUsd: p.optTradeUsd,
  };
}

export interface LiveModels {
  baseline: BaselineModel;
  baselineV2: BaselineV2Model | null;
  anfis: AnfisModel | null;
}

/** Modele bez parametrów z bazy (przed pierwszym `loadLiveModels` albo gdy tabela pusta). */
export function defaultLiveModels(): LiveModels {
  return { baseline: new BaselineModel(), baselineV2: null, anfis: null };
}

export function scoreLive(f: Features, m: LiveModels): LiveScoresDto {
  const b = m.baseline.score(f);
  const md = evaluateArbitrage({ S: f.S, G: f.G, L: f.L, M: f.M });
  const v2 = m.baselineV2?.score(f) ?? null;
  const an = m.anfis?.score(f) ?? null;
  return {
    baseline: { score: b.score, label: b.label },
    mamdani: { score: md.value, label: md.label },
    baseline_v2: v2 ? { score: v2.score, label: v2.label } : null,
    anfis: an ? { score: an.score, label: an.label } : null,
  };
}
