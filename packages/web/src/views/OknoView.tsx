// Widok "Okno" — cztery wykresy (ceny obu puli, spread z progiem, gaz, score modeli) dla
// wybranej pary×okna, ze wspólnym zakresem bloków sterowanym brushem na wykresie spreadu
// (useBrushRange, debounce 300 ms) — patrz też packages/web/src/views/okno/*. Link "Okazje" w
// nagłówku prowadzi do /okazje/:pairId/:windowId dla tej samej pary×okna. KPI liczone z samej
// serii (spec §4: bez nowych endpointów) — „Kubełki ≥ progu” to przybliżenie liczby okazji,
// „Pokrycie stanów” to udział kubełków z ceną obu pul; oba z hintem.
import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { SeriesResponse } from "@dex-arb/shared";
import { usePairs, useWindows, useSeries } from "../api/hooks";
import { toChartRows } from "./okno/chartUtils";
import { useBrushRange } from "./okno/useBrushRange";
import { PriceChart } from "./okno/PriceChart";
import { SpreadChart } from "./okno/SpreadChart";
import { GasChart } from "./okno/GasChart";
import { ScoreChart } from "./okno/ScoreChart";
import { Loading, ErrorMessage } from "../components/Status";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import type { StatProps } from "../components/ui/Stat";
import { fmtInt, fmtPct, median } from "../format";

export function oknoStats(s: SeriesResponse): StatProps[] {
  const n = s.points.length;
  const withBoth = s.points.filter((p) => p.price_a != null && p.price_b != null).length;
  const aboveThreshold = s.points.filter((p) => p.spread_max != null && p.spread_max >= s.threshold_pct).length;
  const med = median(s.points.map((p) => p.spread_avg).filter((v): v is number => v != null));
  return [
    { label: "Bloki w oknie", value: fmtInt(s.to_block - s.from_block + 1) },
    { label: "Pokrycie stanów", value: n === 0 ? "—" : `${Math.round((withBoth / n) * 100)} %`, hint: "kubełki z ceną obu pul" },
    { label: "Kubełki ≥ progu", value: fmtInt(aboveThreshold), hint: "z serii, nie z tabeli okazji", tone: aboveThreshold > 0 ? "accent" : "muted" },
    { label: "Mediana spreadu", value: med == null ? "—" : fmtPct(med) },
  ];
}

export function OknoView() {
  const params = useParams();
  const navigate = useNavigate();
  const pairId = params.pairId ? Number(params.pairId) : undefined;
  const windowId = params.windowId ? Number(params.windowId) : undefined;
  const pairs = usePairs();
  const windows = useWindows();
  const win = windows.data?.find((w) => w.id === windowId);
  const pair = pairs.data?.find((p) => p.id === pairId);
  const { range, setFromBrush, reset } = useBrushRange(win);
  // `SeriesRange` (`useSeries`) ma `exactOptionalPropertyTypes` — nie przyjmuje jawnego
  // `undefined`, więc pomijamy klucze zamiast przekazywać `range` wprost.
  const seriesRange = range.from !== undefined && range.to !== undefined ? { from: range.from, to: range.to } : {};
  const series = useSeries(pairId, windowId, seriesRange);
  const rows = useMemo(() => (series.data ? toChartRows(series.data) : []), [series.data]);

  // Na `/okno` (bez pary/okna w adresie) wybór samej pary lub samego okna też nawiguje —
  // brakującą część dopełniamy pierwszą wczytaną parą/oknem.
  const go = (p: number | undefined, w: number | undefined) => {
    const pairTarget = p ?? pairs.data?.[0]?.id;
    const windowTarget = w ?? windows.data?.[0]?.id;
    if (pairTarget && windowTarget) {
      reset();
      navigate(`/okno/${pairTarget}/${windowTarget}`);
    }
  };

  const context = series.data ? (
    <>
      bloki {series.data.from_block}–{series.data.to_block}, krok {series.data.step} bl., {fmtInt(series.data.points.length)} pkt
      {series.isFetching && " · ładowanie…"}
    </>
  ) : undefined;

  return (
    <>
      <PageHeader
        crumbs={["Okno", pair?.symbol ?? "—", win?.name ?? "—"]}
        title="Okno"
        context={context}
        stats={series.data ? oknoStats(series.data) : undefined}
        actions={
          <>
            {series.data && (
              <Button size="sm" onClick={reset} disabled={range.from == null}>
                Cały zakres
              </Button>
            )}
            {pairId && windowId && (
              <Link className="btn btn--ghost btn--sm" to={`/okazje/${pairId}/${windowId}`}>
                Okazje
              </Link>
            )}
          </>
        }
      />
      <div className="toolbar">
        <label className="field">
          <span className="label">Para</span>
          <select aria-label="Para" value={pairId ?? ""} onChange={(e) => go(Number(e.target.value) || undefined, windowId)}>
            <option value="">—</option>
            {pairs.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.symbol}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Okno</span>
          <select aria-label="Okno" value={windowId ?? ""} onChange={(e) => go(pairId, Number(e.target.value) || undefined)}>
            <option value="">—</option>
            {windows.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!pairId || !windowId ? (
        <Card>
          <EmptyState title="Wybierz parę i okno." hint="Wykresy pokazują serię kubełków bloków dla jednej pary × okna." />
        </Card>
      ) : series.isPending ? (
        <Loading />
      ) : series.error ? (
        <ErrorMessage error={series.error} />
      ) : series.data.points.length === 0 ? (
        <Card>
          <EmptyState title="Brak stanów bloków" hint="Zleć „Analizuj” w widoku Dane." action={<Link className="btn btn--secondary btn--sm" to="/dane">Dane</Link>} />
        </Card>
      ) : (
        <div className="stack">
          <PriceChart
            rows={rows}
            poolA={pair?.pools[0]?.dex_name ?? "pula A"}
            poolB={pair?.pools[1]?.dex_name ?? "pula B"}
            title={`Cena ${pair?.symbol ?? ""}`.trim()}
            meta={`USDC za 1 WETH · ${win?.name ?? ""}`}
          />
          <SpreadChart
            rows={rows}
            thresholdPct={series.data.threshold_pct}
            onBrush={(s, e) => setFromBrush(series.data!.points, s, e)}
          />
          <GasChart rows={rows} />
          <ScoreChart rows={rows} models={series.data.models} />
        </div>
      )}
    </>
  );
}
