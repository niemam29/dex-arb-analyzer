// Siatka pokrycia par×okien — karta per komórka (od redesignu 2026-08-27; wcześniej <table>).
// Komponent prezentacyjny (bez znajomości TanStack Query/fetch), sterowany przez `DaneView`
// przez props `onAction`. Reguły przycisków:
// - Pobierz: zawsze aktywny — zleca `jobsForAction('ingest', …)` (po zadaniu na pulę).
// - Analizuj: aktywny tylko gdy okno ma wyznaczone bloki i wszystkie pule pary mają 100% pokrycia.
// - Weryfikuj: aktywny gdy `block_states > 0`. `CoverageCellDto` NIE ma licznika okazji — komórka
//   pokazuje `block_states`/`scored_models`; rozkład statusów weryfikacji jest w widoku Okazje.
// - Linki „Okno”/„Okazje”: widoczne, gdy komórka ma jakiekolwiek `block_states`.
import { Link } from "react-router-dom";
import type { CoverageCellDto, PairDto, PoolCoverageDto, WindowDto } from "@dex-arb/shared";
import type { ActionKind } from "./jobActions";
import { Card } from "../../components/ui/Card";
import { Bar } from "../../components/ui/Bar";
import { Button } from "../../components/ui/Button";
import { fmtInt } from "../../format";

export type CoverageTableProps = {
  pairs: PairDto[];
  windows: WindowDto[];
  coverage: CoverageCellDto[];
  onAction: (kind: ActionKind, pair: PairDto, win: WindowDto) => void;
};

function isFullyIngested(cell: CoverageCellDto | undefined): boolean {
  if (!cell || !cell.window_has_blocks || cell.pools.length === 0) return false;
  return cell.pools.every((p) => p.coverage_pct != null && p.coverage_pct >= 100);
}

function PoolRow({ pool }: { pool: PoolCoverageDto }) {
  const pct = pool.coverage_pct;
  return (
    <div className="pool-row">
      <span className="pool-name">{pool.dex_name}</span>
      <span className="pool-pct num">{pct == null ? "brak bloków" : `${Math.floor(pct)}%`}</span>
      <Bar value={(pct ?? 0) / 100} tone={pool.failed_blocks > 0 ? "warn" : "ok"} label={`pokrycie ${pool.dex_name}`} />
      {pool.failed_blocks > 0 && <span className="pool-failed">błędy: {fmtInt(pool.failed_blocks)} bl.</span>}
    </div>
  );
}

export function CoverageTable({ pairs, windows, coverage, onAction }: CoverageTableProps) {
  const cellFor = (pairId: number, windowId: number) =>
    coverage.find((c) => c.pair_id === pairId && c.window_id === windowId);

  return (
    <div className="coverage-grid" role="list" aria-label="Pokrycie danych par×okien">
      {pairs.flatMap((pair) =>
        windows.map((win) => {
          const cell = cellFor(pair.id, win.id);
          const fullyIngested = isFullyIngested(cell);
          const hasStates = !!cell && cell.block_states > 0;
          return (
            <div key={`${pair.id}-${win.id}`} role="listitem">
              <Card title={pair.symbol} meta={win.name} className="coverage-cell">
                {cell ? (
                  <div className="pool-rows">
                    {cell.pools.map((p) => (
                      <PoolRow key={p.pool_id} pool={p} />
                    ))}
                  </div>
                ) : (
                  <p className="muted">brak danych</p>
                )}
                <dl className="cell-counts">
                  <dt>stany</dt>
                  <dd className="num">{fmtInt(cell?.block_states ?? 0)}</dd>
                  <dt>modele</dt>
                  <dd className="num">{fmtInt(cell?.scored_models ?? 0)}</dd>
                </dl>
                <div className="cell-actions">
                  <Button size="sm" onClick={() => onAction("ingest", pair, win)}>
                    Pobierz
                  </Button>
                  <Button size="sm" disabled={!fullyIngested} onClick={() => onAction("analyze", pair, win)}>
                    Analizuj
                  </Button>
                  <Button size="sm" disabled={!hasStates} onClick={() => onAction("verify", pair, win)}>
                    Weryfikuj
                  </Button>
                  {hasStates && (
                    <span className="cell-links">
                      <Link className="btn btn--ghost btn--sm" to={`/okno/${pair.id}/${win.id}`}>
                        Okno
                      </Link>
                      <Link className="btn btn--ghost btn--sm" to={`/okazje/${pair.id}/${win.id}`}>
                        Okazje
                      </Link>
                    </span>
                  )}
                </div>
              </Card>
            </div>
          );
        }),
      )}
    </div>
  );
}
