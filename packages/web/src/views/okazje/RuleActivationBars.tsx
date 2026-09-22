// Pasek aktywacji reguł Mamdaniego — 16 poziomych słupków R1–R16 (prymityw Bar w akcencie),
// szerokość proporcjonalna do siły odpalenia (0–1). Opisy w RULE_DESCRIPTIONS (tooltip `title`)
// spisane 1:1 z warunków if/then reguł DEFAULT_MAMDANI_PARAMS.rules
// (packages/core/src/mamdani.params.ts).
import { Bar } from "../../components/ui/Bar";

export const RULE_DESCRIPTIONS: Record<string, string> = {
  R1: "S: znikoma → niewykonalna",
  R2: "G: zaporowy → niewykonalna",
  R3: "S: umiarkowana, L: płytka → niewykonalna",
  R4: "S: umiarkowana, G: umiarkowany, M: nie niskie → niewykonalna",
  R5: "S: umiarkowana, G: niski, L: głęboka, M: niskie → wykonalna",
  R6: "S: umiarkowana, G: niski, M: średnie → ryzykowna",
  R7: "S: umiarkowana, G: niski, L: średnia, M: niskie → wykonalna",
  R8: "S: umiarkowana, G: niski, M: wysokie → ryzykowna",
  R9: "S: umiarkowana, G: umiarkowany, L: nie płytka, M: niskie → ryzykowna",
  R10: "S: duża, G: niski, L: głęboka, M: niskie → atrakcyjna",
  R11: "S: duża, G: niski, L: nie płytka, M: średnie → wykonalna",
  R12: "S: duża, G: niski, L: średnia, M: niskie → atrakcyjna",
  R13: "S: duża, G: niski, M: wysokie → ryzykowna",
  R14: "S: duża, G: umiarkowany, L: nie płytka, M: niskie → wykonalna",
  R15: "S: duża, G: umiarkowany, M: nie niskie → ryzykowna",
  R16: "S: duża, L: płytka → ryzykowna",
};

export type RuleActivationBarsProps = { activations: { id: string; strength: number }[] };

export function RuleActivationBars({ activations }: RuleActivationBarsProps) {
  return (
    <ul className="rule-bars">
      {activations.map((a) => (
        <li key={a.id} title={RULE_DESCRIPTIONS[a.id] ?? a.id}>
          <span className="rule-id mono">{a.id}</span>
          <Bar value={a.strength} tone="accent" />
          <span className="rule-val num">{a.strength.toFixed(2)}</span>
        </li>
      ))}
    </ul>
  );
}
