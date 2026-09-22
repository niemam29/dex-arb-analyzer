/**
 * Model bazowy (nierozmyty): próg binarny na zysku netto (spec §5). Punkt odniesienia
 * dla oceny FIS w ewaluacji — bez stref pośrednich (ryzykowna/atrakcyjna),
 * tylko wykonalna/niewykonalna.
 */
import { z } from "zod";
import { ARB_GAS } from "./features.js";
import type { Features, ScoreResult, ScoringModel } from "./types.js";

export interface BaselineParams {
  /** gaz transakcji arbitrażowej (2 swapy + transfer) */
  arbGas: number;
  /** mnożnik ROI -> score (10 000: ROI 1 % = 100 pkt) */
  roiScale: number;
}

export const DEFAULT_BASELINE_PARAMS: BaselineParams = { arbGas: ARB_GAS, roiScale: 10_000 };

/** Walidacja parametrów wczytanych z `scoring_models.params` (jsonb, więc `unknown` na wejściu). */
export const baselineParamsSchema = z.object({
  arbGas: z.number().positive(),
  roiScale: z.number().positive(),
}) satisfies z.ZodType<BaselineParams>;

/** Parsuje `scoring_models.params` na `BaselineParams` — rzuca, gdy kształt się nie zgadza. */
export function parseBaselineParams(params: unknown): BaselineParams {
  return baselineParamsSchema.parse(params);
}

/** Zysk netto baseline: brutto − arbGas·gwei·ETHUSD (koszt gazu w USD). */
export function baselineNetProfitUsd(
  grossProfitUsd: number,
  gasPriceGwei: number,
  ethUsd: number,
  arbGas = ARB_GAS,
): number {
  return grossProfitUsd - arbGas * gasPriceGwei * 1e-9 * ethUsd;
}

/** Model bazowy: próg na netProfitUsd, score = ROI (netProfitUsd/optTradeUsd) skalowany do 0–100. */
export class BaselineModel implements ScoringModel {
  readonly kind = "baseline" as const;
  readonly params: BaselineParams;

  constructor(params: Partial<BaselineParams> = {}) {
    this.params = { ...DEFAULT_BASELINE_PARAMS, ...params };
  }

  score(f: Features): ScoreResult {
    const feasible = f.optTradeUsd > 0 && f.netProfitUsd > 0;
    const roi = feasible ? f.netProfitUsd / f.optTradeUsd : 0;
    const score = Math.max(0, Math.min(100, roi * this.params.roiScale));
    return {
      score,
      label: feasible ? "wykonalna" : "niewykonalna",
      details: { netProfitUsd: f.netProfitUsd, roi, feasible },
    };
  }
}
