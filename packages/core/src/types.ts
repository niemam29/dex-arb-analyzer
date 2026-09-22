/** Etykiety lingwistyczne wyjścia W (kolejność = rosnąca wykonalność). */
export const LABELS = ["niewykonalna", "ryzykowna", "wykonalna", "atrakcyjna"] as const;
export type Label = (typeof LABELS)[number];

/** Cechy bloku (spec §5): S spread [%], G względny koszt gazu [%], L TVL [mln USD], M ryzyko MEV [pkt]. */
export interface Features {
  S: number;
  G: number;
  L: number;
  M: number;
  /** zysk netto v1 [USD] = `grossProfitUsd` − koszt gazu v1 (220k·gwei·ETHUSD); `block_states.baseline_net_profit_usd` */
  netProfitUsd: number;
  /**
   * zysk brutto [USD] przed gazem (`block_states.gross_profit_usd`) — wymagany, żeby
   * `BaselineV2Model.score(Features)` liczył DOKŁADNIE to, co `scoreInputs` (koszt gazu v1 =
   * `grossProfitUsd − netProfitUsd`, bez odtwarzania z samego netto). 0 dla bloku bez kierunku arbitrażu.
   */
  grossProfitUsd: number;
  optTradeUsd: number;
}

/** Rodzaj modelu oceny — zgodny z `model_kind` DB enum (`baseline_v2` = baseline skalibrowany, migracja 0006). */
export type ModelKind = "baseline" | "baseline_v2" | "mamdani" | "anfis";

export interface ScoreResult {
  /** 0–100 */
  score: number;
  label: Label;
  details?: unknown;
}

export interface ScoringModel {
  kind: ModelKind;
  score(f: Features): ScoreResult;
}
