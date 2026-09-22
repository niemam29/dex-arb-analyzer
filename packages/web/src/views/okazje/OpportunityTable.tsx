// Tabela okazji arbitrażowych — komponent prezentacyjny (bez znajomości TanStack Query/fetch),
// sterowany przez `OkazjeView` przez props. Kolumna "Model" pojawia się tylko gdy podano
// `modelName` (odpowiada parametrowi `?model=` z GET .../opportunities — `scores` w
// OpportunityListItem to mapa tylko dla tego jednego modelu, patrz
// packages/shared/src/dto/opportunities.ts). Kartę wokół tabeli (i paginację w stopce) daje
// OkazjeView; tu `.table-scroll` + `.table`.
import type { OpportunityListItem, VerificationStatus } from "@dex-arb/shared";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { fmtBlock, fmtPct, fmtUsd } from "../../format";

// Formatery przeniesione do src/format.ts (redesign 2026-08-27) — re-eksport dla starych importów.
export { fmtUsd, fmtPct } from "../../format";

// `direction` z DTO to string wolnej formy (patrz OpportunityListItem) odpowiadający enumowi
// bazy `direction_kind` (a_to_b/b_to_a/none — packages/db/src/schema, `toDbDirection`). "A"/"B"
// to pula Uniswap V2 / Sushiswap (ta sama konwencja co w docs/konwencje.md repo, sekcja "Decyzje").
const DIRECTION_LABELS: Record<string, string> = {
  a_to_b: "A→B (Uniswap→Sushi)",
  b_to_a: "B→A",
  none: "—",
};
export const directionLabel = (direction: string): string => DIRECTION_LABELS[direction] ?? direction;

// Krótka forma kierunku dla komórki tabeli (spec: Okazje ma zmieścić się przy 1440 px bez
// poziomego scrolla) — pełny opis zostaje w `title=` na komórce; panel szczegółów (OpportunityDetail)
// używa `directionLabel` bez zmian.
const DIRECTION_SHORT: Record<string, string> = {
  a_to_b: "A→B",
  b_to_a: "B→A",
  none: "—",
};
export const directionShort = (direction: string): string => DIRECTION_SHORT[direction] ?? direction;

const STATUS_LABELS: Record<VerificationStatus, string> = {
  consumed_atomic: "skonsumowana (atomowo)",
  consumed_partial: "skonsumowana częściowo",
  decayed: "wygasła",
  persisted: "utrzymała się",
};

export const statusLabel = (status: VerificationStatus | null | undefined): string =>
  status ? STATUS_LABELS[status] : "niezweryfikowana";

// Krótka forma statusu dla pigułki w komórce tabeli (spec: Okazje ma zmieścić się w jednej
// linii przy 1440 px) — pełny opis `statusLabel` zostaje w `title=` na pigułce; panel
// szczegółów (OpportunityDetail) używa `statusLabel` bez zmian.
const STATUS_SHORT_LABELS: Record<VerificationStatus, string> = {
  consumed_atomic: "atomowo",
  consumed_partial: "częściowo",
  decayed: "wygasła",
  persisted: "utrzymała się",
};

export const statusShortLabel = (status: VerificationStatus | null | undefined): string =>
  status ? STATUS_SHORT_LABELS[status] : "niezweryfikowana";

/** Ton pigułki statusu weryfikacji (spec §5). */
export const STATUS_TONE: Record<VerificationStatus | "unverified", BadgeTone> = {
  consumed_atomic: "ok",
  consumed_partial: "warn",
  decayed: "muted",
  persisted: "danger",
  unverified: "muted",
};

export type OpportunityTableProps = {
  items: OpportunityListItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** Nazwa modelu z filtra `?model=` — steruje widocznością kolumny "Model". */
  modelName?: string | undefined;
};

export function OpportunityTable({ items, selectedId, onSelect, modelName }: OpportunityTableProps) {
  return (
    <div className="table-scroll">
      <table className="table opps" aria-label="Okazje arbitrażowe">
        <caption>Okazje arbitrażowe</caption>
        <thead>
          <tr>
            <th className="key">Blok</th>
            <th className="num">Spread</th>
            <th>Kierunek</th>
            <th className="num">Zysk est.</th>
            <th>Status</th>
            <th className="num">Zysk realny</th>
            <th className="num">Koszt gazu</th>
            <th className="num" title="Bloki do konsumpcji">
              Bloki
            </th>
            {modelName && <th>Model</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const v = it.verification;
            const score = modelName ? (it.scores[modelName] ?? null) : null;
            return (
              <tr
                key={it.id}
                aria-selected={it.id === selectedId}
                className={it.id === selectedId ? "selected" : ""}
                tabIndex={0}
                onClick={() => onSelect(it.id)}
                onKeyDown={(e) => {
                  // Klawiaturowy wybór wiersza — Enter/Spacja jak dla przycisku (rola "row" w
                  // <table> ma zostać nienaruszona dla nawigacji tabelarycznej czytników ekranu,
                  // więc nie nadpisujemy jej na "button"; sam wiersz jest za to fokusowalny).
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(it.id);
                  }
                }}
              >
                <td className="key num">{fmtBlock(it.block)}</td>
                <td className="num">{fmtPct(it.spread_pct)}</td>
                <td title={directionLabel(it.direction)}>{directionShort(it.direction)}</td>
                <td className="num">{fmtUsd(it.est_profit_usd)}</td>
                <td className="opps-status">
                  <Badge tone={STATUS_TONE[v?.status ?? "unverified"]} title={statusLabel(v?.status)}>
                    {statusShortLabel(v?.status)}
                  </Badge>
                  {v?.route === "multi" && (
                    <Badge tone="muted" title="trasa wielopulowa — zysk nieznany">
                      multi
                    </Badge>
                  )}
                  {v &&
                    (v.route === "multi" ? (
                      <Badge tone="muted" title="trasa wielopulowa — zysk nieznany">
                        ?
                      </Badge>
                    ) : (
                      <Badge tone={v.profitable_consumed ? "ok" : "muted"} title={v.profitable_consumed ? "opłacalna" : "nieopłacalna"}>
                        {v.profitable_consumed ? "✓" : "✗"}
                      </Badge>
                    ))}
                </td>
                <td className="num">{fmtUsd(v?.realized_profit_usd)}</td>
                <td className="num">{fmtUsd(v?.gas_cost_usd)}</td>
                <td className="num">{v?.blocks_to_consumption ?? "—"}</td>
                {modelName && <td className="num">{score ? `${score.score.toFixed(1)} (${score.label})` : "—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
