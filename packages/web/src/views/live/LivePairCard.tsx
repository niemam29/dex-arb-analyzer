// Karta jednej pary w panelu na żywo (spec §7): ceny obu pul (kolory --pool-a/--pool-b), spread
// dużą liczbą (.profit gdy ≥ próg), zysk netto/optymalna transakcja/TVL i cechy S/G/L/M w
// dl.detail, 4 pigułki modeli (ton wg etykiety), mini-wykres spreadu z historii. Czysto
// prezentacyjna (eksport w ds.ts).
import { LIVE_MODEL_KEYS, type LiveModelKey, type LivePairDto, type LivePointDto } from "@dex-arb/shared";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { fmtPct, fmtUsd } from "../../format";
import { SparklineChart } from "./SparklineChart";

export type LivePairCardProps = {
  pair: LivePairDto;
  history: LivePointDto[];
  thresholdPct: number;
};

export const MODEL_NAMES: Record<LiveModelKey, string> = {
  baseline: "Baseline",
  mamdani: "Mamdani",
  baseline_v2: "Baseline v2",
  anfis: "ANFIS",
};

const LABEL_TONE: Record<string, BadgeTone> = { atrakcyjna: "ok", wykonalna: "accent", ryzykowna: "warn", niewykonalna: "muted" };

export function scoreTone(label: string | null): BadgeTone {
  return (label && LABEL_TONE[label]) || "muted";
}

const fmt1 = (v: number) => v.toLocaleString("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt3 = (v: number) => v.toLocaleString("pl-PL", { maximumFractionDigits: 3 });

export function scoreBadgeText(key: LiveModelKey, s: { score: number; label: string } | null): string {
  return s ? `${MODEL_NAMES[key]} ${fmt1(s.score)} · ${s.label}` : `${MODEL_NAMES[key]} —`;
}

export function directionLabel(p: Pick<LivePairDto, "direction" | "pool_a" | "pool_b">): string {
  if (p.direction === "a_to_b") return `kup ${p.pool_a.dex_name} → sprzedaj ${p.pool_b.dex_name}`;
  if (p.direction === "b_to_a") return `kup ${p.pool_b.dex_name} → sprzedaj ${p.pool_a.dex_name}`;
  return "brak kierunku";
}

const M_HINT =
  "M — ryzyko MEV: percentyle liczone po historii próbek z ostatniej godziny (nie po całym oknie jak w trybie historycznym); 50 do czasu zebrania 10 próbek; " +
  "swapy: średnia z ostatnich 20 bloków obu puli (w batchu: liczba w bloku)";

export function LivePairCard({ pair, history, thresholdPct }: LivePairCardProps) {
  const above = pair.spread_pct >= thresholdPct;
  const noDirection = pair.direction === "none";
  return (
    <Card className="live-card" title={pair.symbol} meta={directionLabel(pair)}>
      <div className="live-prices">
        <span className="live-price live-price--a">
          <span className="label">{pair.pool_a.dex_name}</span> <span className="num">{fmtUsd(pair.pool_a.price)}</span>
        </span>
        <span className="live-price live-price--b">
          <span className="label">{pair.pool_b.dex_name}</span> <span className="num">{fmtUsd(pair.pool_b.price)}</span>
        </span>
      </div>
      <div className={above ? "live-spread profit" : "live-spread"} data-testid="live-spread">
        {fmtPct(pair.spread_pct)}
      </div>
      <dl className="detail">
        <dt>Zysk netto</dt>
        <dd className="num">{noDirection ? "—" : fmtUsd(pair.net_profit_usd)}</dd>
        <dt>Optymalna transakcja</dt>
        <dd className="num">{noDirection ? "—" : fmtUsd(pair.opt_trade_usd)}</dd>
        <dt>TVL (płytsza pula)</dt>
        <dd className="num">{fmtUsd(pair.tvl_min_usd)}</dd>
        <dt title={M_HINT}>S / G / L / M</dt>
        <dd className="num">
          {fmt3(pair.features.s)} / {fmt3(pair.features.g)} / {fmt3(pair.features.l)} / {fmt3(pair.features.m)}
        </dd>
      </dl>
      <div className="live-badges">
        {LIVE_MODEL_KEYS.map((k) => (
          <Badge key={k} tone={scoreTone(pair.scores[k]?.label ?? null)}>
            {scoreBadgeText(k, pair.scores[k])}
          </Badge>
        ))}
      </div>
      <SparklineChart points={history} thresholdPct={thresholdPct} />
    </Card>
  );
}
