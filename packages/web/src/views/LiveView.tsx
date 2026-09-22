// Widok „Na żywo" (spec §7): GET /live co 15 s (useLive), czysto prezentacyjny względem DTO.
// KPI (Blok, ETH/USD, Gaz, Pary ≥ progu) z `liveStats`, wiek próbki w kontekście, banner
// `.status--error` przy `stale`, EmptyState przy `enabled=false`, siatka 2×2 LivePairCard i tabela
// ostatnich LIVE_RECENT_ROWS próbek (czas, blok, per para spread + ocena ANFIS).
// Zegar wieku próbki żyje wyłącznie w `<SampleAge>` (własny useNow co 1 s) — reszta widoku (karty,
// 4 wykresy Recharts, tabela) w `<LiveBody>` re-renderuje się tylko przy zmianie danych z GET /live
// (co LIVE_POLL_MS_DEFAULT), nie co sekundę.
import { useEffect, useState } from "react";
import { LIVE_POLL_MS_DEFAULT, LIVE_RECENT_ROWS, SPREAD_THRESHOLD_PCT, type LivePointDto, type LiveSnapshotDto } from "@dex-arb/shared";
import { useLive } from "../api/live";
import { Loading, ErrorMessage } from "../components/Status";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import type { StatProps } from "../components/ui/Stat";
import { fmtBlock, fmtInt, fmtPct, fmtUsd } from "../format";
import { LivePairCard, scoreBadgeText } from "./live/LivePairCard";

const fmtGwei = (v: number) => `${v.toLocaleString("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} gwei`;

export function liveStats(s: LiveSnapshotDto): StatProps[] {
  const above = s.pairs.filter((p) => p.spread_pct >= SPREAD_THRESHOLD_PCT).length;
  return [
    { label: "Blok", value: fmtBlock(s.block) },
    { label: "ETH/USD", value: s.eth_usd == null ? "—" : fmtUsd(s.eth_usd) },
    { label: "Gaz", value: s.gas_gwei == null ? "—" : fmtGwei(s.gas_gwei) },
    { label: "Pary ≥ progu", value: fmtInt(above), hint: `z ${s.pairs.length}`, tone: above > 0 ? "accent" : "muted" },
  ];
}

/** „12 s temu” / „3 min temu” — wiek ostatniej dobrej próbki. */
export function sampleAge(at: string, now: Date): string {
  const sec = Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / 1000));
  return sec < 60 ? `${sec} s temu` : `${Math.floor(sec / 60)} min temu`;
}

export interface RecentRow {
  at: string;
  block: number;
  cells: { pair_id: number; symbol: string; point: LivePointDto | null }[];
}

/** Ostatnie próbki (od najnowszej): klucz = (at, block) z historii dowolnej pary; komórka null, gdy para nie ma punktu. */
export function recentRows(s: LiveSnapshotDto, limit = LIVE_RECENT_ROWS): RecentRow[] {
  const keys = new Map<string, { at: string; block: number }>();
  for (const points of Object.values(s.history)) for (const p of points) keys.set(`${p.at}|${p.block}`, { at: p.at, block: p.block });
  const ordered = [...keys.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.block - a.block)).slice(0, limit);
  return ordered.map(({ at, block }) => ({
    at,
    block,
    cells: s.pairs.map((pair) => ({
      pair_id: pair.pair_id,
      symbol: pair.symbol,
      point: (s.history[String(pair.pair_id)] ?? []).find((p) => p.at === at && p.block === block) ?? null,
    })),
  }));
}

const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Zegar do wieku próbki — odświeżany co sekundę, żeby „12 s temu” tykało między refetchami. */
function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * Wiek ostatniej dobrej próbki — jedyny fragment widoku z zegarem 1 Hz. Wydzielony jako osobny
 * komponent, żeby ticking `useNow()` re-renderował TYLKO ten tekst, nie karty/wykresy/tabelę w
 * reszcie `LiveView` (te re-renderują się wyłącznie przy nowych danych z GET /live).
 */
function SampleAge({ at }: { at: string }) {
  const now = useNow();
  return <>{sampleAge(at, now)}</>;
}

interface LiveBodyProps {
  snapshot: LiveSnapshotDto;
}

/** Karty + tabela ostatnich próbek — wydzielone z `LiveView`, żeby nie powtarzać `s!` przy każdym polu i żeby ten fragment nie zależał od zegara wieku próbki (patrz `SampleAge`). */
function LiveBody({ snapshot: s }: LiveBodyProps) {
  return (
    <div className="stack">
      {s.stale && (
        <p className="status status--error" role="alert">
          Brak świeżej próbki: {s.error ?? "błąd RPC"} — pokazuję ostatnią dobrą próbkę z {timeLabel(s.at!)}.
        </p>
      )}
      <div className="live-grid">
        {s.pairs.map((p) => (
          <LivePairCard key={p.pair_id} pair={p} history={s.history[String(p.pair_id)] ?? []} thresholdPct={SPREAD_THRESHOLD_PCT} />
        ))}
      </div>
      <Card title="Ostatnie próbki" meta={`ostatnie ${LIVE_RECENT_ROWS} · spread i ocena ANFIS per para`} padded={false}>
        <div className="table-scroll">
          <table className="table live-recent" aria-label="Ostatnie próbki">
            <thead>
              <tr>
                <th>Czas</th>
                <th className="num">Nr bloku</th>
                {s.pairs.map((p) => (
                  <th key={p.pair_id}>{p.symbol}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentRows(s).map((r) => (
                <tr key={`${r.at}|${r.block}`}>
                  <td className="mono">{timeLabel(r.at)}</td>
                  <td className="num mono">{fmtBlock(r.block)}</td>
                  {r.cells.map((c) => (
                    <td key={c.pair_id} className="num">
                      {c.point ? (
                        <>
                          <span className={c.point.spread_pct >= SPREAD_THRESHOLD_PCT ? "profit" : undefined}>{fmtPct(c.point.spread_pct)}</span>
                          <span className="muted"> · {scoreBadgeText("anfis", c.point.scores.anfis)}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function LiveView() {
  const live = useLive();
  const s = live.data;

  const context = s ? (
    <>
      Ethereum mainnet · eRPC · próbka co {LIVE_POLL_MS_DEFAULT / 1000} s
      {s.at && (
        <>
          {" · "}
          <SampleAge at={s.at} />
        </>
      )}
      {!s.consistent && " · rezerwy z tagiem latest (możliwy rozjazd ±1 bloku)"}
    </>
  ) : undefined;

  return (
    <>
      <PageHeader crumbs={["Na żywo"]} title="Na żywo" context={context} stats={s && s.enabled ? liveStats(s) : undefined} />
      {live.isPending ? (
        <Loading />
      ) : live.error ? (
        <ErrorMessage error={live.error} />
      ) : !s!.enabled ? (
        <Card>
          <EmptyState title="Tryb na żywo wyłączony (LIVE_ENABLED)" hint="Ustaw RPC_URL w .env (i LIVE_ENABLED=true), potem zrestartuj API." />
        </Card>
      ) : s!.at == null ? (
        <Card>
          <EmptyState title="Czekam na pierwszą próbkę…" hint={s!.error ? `Ostatni błąd: ${s!.error}` : "API odpytuje eRPC co 15 s."} />
        </Card>
      ) : (
        <LiveBody snapshot={s!} />
      )}
    </>
  );
}
