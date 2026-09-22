// Widok "Okazje" — tabela okazji arbitrażowych dla pary×okna (GET
// /pairs/:id/windows/:wid/opportunities) z filtrami (status, min. spread, model) sterowanymi
// przez URL (?status=&min_spread=&model=&page=), paginacją i panelem szczegółów po kliknięciu
// wiersza. Para/okno w ścieżce `/okazje/:pairId/:windowId`, jak w widoku Okno. KPI w nagłówku:
// bloki i okazje są dokładne (okno / `total`), atomowe i mediana zysku liczone z pobranej strony
// (hint „na tej stronie") — nie dodajemy endpointów (spec §4).
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { VERIFICATION_STATUSES, type OpportunityListItem, type OpportunityListQuery, type WindowDto } from "@dex-arb/shared";
import { usePairs, useWindows, useModels } from "../api/hooks";
import { useOpportunities } from "../api/opportunities";
import { OpportunityTable, statusLabel } from "./okazje/OpportunityTable";
import { OpportunityDetailPanel } from "./okazje/OpportunityDetail";
import { Loading, ErrorMessage } from "../components/Status";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import type { StatProps } from "../components/ui/Stat";
import { fmtInt, fmtUsd, median } from "../format";

const PAGE_SIZE = 50;

const STATUS_OPTIONS: Array<[string, string]> = [
  ["", "wszystkie"],
  ...VERIFICATION_STATUSES.map((s): [string, string] => [s, statusLabel(s)]),
  ["unverified", "niezweryfikowana"],
];

export function okazjeStats(items: OpportunityListItem[], total: number, win: WindowDto | undefined): StatProps[] {
  const blocks = win && win.from_block != null && win.to_block != null ? win.to_block - win.from_block + 1 : null;
  const atomic = items.filter((i) => i.verification?.status === "consumed_atomic");
  const multi = atomic.filter((i) => i.verification?.route === "multi").length;
  const twoPoolProfits = atomic
    .filter((i) => i.verification?.route === "two_pool")
    .map((i) => i.verification?.realized_profit_usd)
    .filter((p): p is number => p != null);
  return [
    { label: "Bloki w oknie", value: blocks == null ? "—" : fmtInt(blocks) },
    { label: "Okazje", value: fmtInt(total) },
    { label: "Skonsumowane atomowo", value: multi > 0 ? `${fmtInt(atomic.length)} (w tym ${fmtInt(multi)} multi)` : fmtInt(atomic.length), hint: "na tej stronie", tone: "ok" },
    { label: "Mediana zysku two_pool", value: fmtUsd(median(twoPoolProfits)), hint: "na tej stronie" },
  ];
}

export function OkazjeView() {
  const params = useParams();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const pairId = params.pairId ? Number(params.pairId) : undefined;
  const windowId = params.windowId ? Number(params.windowId) : undefined;
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const pairs = usePairs();
  const windows = useWindows();
  const models = useModels();
  const pair = pairs.data?.find((p) => p.id === pairId);
  const win = windows.data?.find((w) => w.id === windowId);

  const status = (sp.get("status") || undefined) as OpportunityListQuery["status"] | undefined;
  const minSpreadStr = sp.get("min_spread") ?? "";
  const minSpread = minSpreadStr !== "" ? Number(minSpreadStr) : undefined;
  const model = sp.get("model") || undefined;
  const page = Number(sp.get("page")) || 1;

  const list = useOpportunities(pairId ?? null, windowId ?? null, {
    status,
    min_spread: minSpread,
    model,
    page,
    page_size: PAGE_SIZE,
  });
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.page_size)) : 1;

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setSp(next);
  };

  // Zmiana pary/okna zeruje filtry, stronę i wybraną okazję z poprzedniego wyboru — inaczej np.
  // `status=decayed`/`page=3` albo panel szczegółów zostałby wybrany dla zupełnie innej listy.
  // Na `/okazje` (bez pary/okna w adresie) wybór samej pary lub samego okna też ma nawigować —
  // brakującą część dopełniamy pierwszą wczytaną parą/oknem, żeby pole nie „nie reagowało".
  const go = (p: number | undefined, w: number | undefined) => {
    const pairTarget = p ?? pairs.data?.[0]?.id;
    const windowTarget = w ?? windows.data?.[0]?.id;
    if (pairTarget && windowTarget) {
      setSelectedId(null);
      navigate({ pathname: `/okazje/${pairTarget}/${windowTarget}`, search: "" });
    }
  };

  return (
    <>
      <PageHeader
        crumbs={["Okazje", pair?.symbol ?? "—", win?.name ?? "—"]}
        title="Okazje"
        stats={list.data ? okazjeStats(list.data.items, list.data.total, win) : undefined}
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
        <label className="field">
          <span className="label">Status</span>
          <select aria-label="Status" value={sp.get("status") ?? ""} onChange={(e) => setFilter("status", e.target.value)}>
            {STATUS_OPTIONS.map(([v, l]) => (
              <option key={v || "all"} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">min. spread %</span>
          <input
            aria-label="min. spread %"
            type="number"
            step="0.05"
            min="0"
            value={minSpreadStr}
            onChange={(e) => setFilter("min_spread", e.target.value)}
          />
        </label>
        <label className="field">
          <span className="label">Model</span>
          <select aria-label="Model" value={sp.get("model") ?? ""} onChange={(e) => setFilter("model", e.target.value)}>
            <option value="">— brak —</option>
            {models.data?.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!pairId || !windowId ? (
        <Card>
          <EmptyState title="Wybierz parę i okno." hint="Okazje są liczone per para × okno — wybierz je w polach powyżej." />
        </Card>
      ) : list.isPending ? (
        <Loading />
      ) : list.error ? (
        <ErrorMessage error={list.error} />
      ) : (
        <div className="split">
          <Card
            title="Okazje arbitrażowe"
            meta={`${fmtInt(list.data.total)} okazji${list.isFetching ? " · odświeżanie…" : ""}`}
            padded={false}
          >
            {list.data.items.length === 0 ? (
              <EmptyState title="Brak okazji dla tych filtrów." />
            ) : (
              <OpportunityTable items={list.data.items} selectedId={selectedId} onSelect={setSelectedId} modelName={model} />
            )}
            <div className="card-footer pager">
              <Button size="sm" disabled={page <= 1} onClick={() => setFilter("page", String(page - 1))}>
                ‹ poprzednia
              </Button>
              <span className="pager-info">
                strona {page} / {totalPages}
              </span>
              <Button size="sm" disabled={page >= totalPages} onClick={() => setFilter("page", String(page + 1))}>
                następna ›
              </Button>
            </div>
          </Card>
          <OpportunityDetailPanel id={selectedId} />
        </div>
      )}
    </>
  );
}
