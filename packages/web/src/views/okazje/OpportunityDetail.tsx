// Panel szczegółów okazji (GET /opportunities/:id) — rezerwy obu pul, cechy S/G/L/M, baseline,
// aktywacje reguł Mamdaniego (liczone on-the-fly po stronie API) i sekcja weryfikacji
// retrospektywnej z linkiem do Etherscan. Kształt danych dokładnie wg
// packages/shared/src/dto/opportunities.ts (OpportunityDetail). Od redesignu 2026-08-27: Card
// z sekcjami `dl.detail` (klucz szary, wartość tabelaryczna).
import type { ReactNode } from "react";
import { useOpportunity } from "../../api/opportunities";
import { RuleActivationBars } from "./RuleActivationBars";
import { directionLabel, statusLabel, STATUS_TONE } from "./OpportunityTable";
import { Loading, ErrorMessage } from "../../components/Status";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { fmtBlock, fmtPct, fmtUsd, shortHash } from "../../format";

export type OpportunityDetailPanelProps = { id: number | null };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="detail-section">
      <h4 className="label">{title}</h4>
      {children}
    </section>
  );
}

export function OpportunityDetailPanel({ id }: OpportunityDetailPanelProps) {
  const q = useOpportunity(id);
  if (id == null)
    return (
      <aside className="detail">
        <Card title="Szczegóły okazji">
          <EmptyState title="Wybierz okazję." hint="Kliknij wiersz w tabeli albo wybierz go klawiaturą (Enter/Spacja)." />
        </Card>
      </aside>
    );
  if (q.isPending)
    return (
      <aside className="detail">
        <Card title="Szczegóły okazji">
          <Loading />
        </Card>
      </aside>
    );
  if (q.error || !q.data)
    return (
      <aside className="detail error">
        <Card title="Szczegóły okazji">
          <ErrorMessage error={q.error} />
        </Card>
      </aside>
    );

  const d = q.data;
  const v = d.verification;
  // Zysk realny/koszt gazu/netto mają sens tylko dla `consumed_atomic` (tx skonsumowała okazję
  // atomowo, w jednej transakcji) — `consumed_partial`/`decayed`/`persisted` nie mają takiej tx,
  // więc bez tej bramki sekcja pokazywałaby "Netto: — — nieopłacalna po gazie" dla KAŻDEJ
  // niekonsumowanej okazji, co sugeruje pomiar tam, gdzie miary po prostu nie ma.
  const showProfit = v?.status === "consumed_atomic";
  // Trasa 'multi' (agregator / więcej pul): zysk dwupulowy NIEZNANY (realized_profit_usd null),
  // więc nie wolno pokazać "nieopłacalna po gazie" — to nie pomiar, tylko brak pomiaru.
  const isMulti = showProfit && v.route === "multi";
  const net = showProfit && v.realized_profit_usd != null && v.gas_cost_usd != null ? v.realized_profit_usd - v.gas_cost_usd : null;
  const est = d.est_profit_usd;

  return (
    <aside className="detail">
      <Card
        title={`Okazja #${d.id} · blok ${fmtBlock(d.block)}`}
        meta={<Badge tone={STATUS_TONE[v?.status ?? "unverified"]}>{statusLabel(v?.status)}</Badge>}
      >
        <p className="detail-summary">
          spread <span className="num">{fmtPct(d.spread_pct)}</span> · kierunek {directionLabel(d.direction)} · zysk est.{" "}
          <span className={est != null && est > 0 ? "profit" : est != null ? "loss" : ""}>{fmtUsd(est)}</span>
        </p>

        <Section title="Ceny i płynność">
          <dl className="detail">
            <dt>Cena A</dt>
            <dd>{fmtUsd(d.price_a)}</dd>
            <dt>Cena B</dt>
            <dd>{fmtUsd(d.price_b)}</dd>
            <dt>TVL (mniejsza pula)</dt>
            <dd>{fmtUsd(d.tvl_min_usd)}</dd>
            {d.gas_price_median != null && (
              <>
                <dt>Mediana ceny gazu</dt>
                <dd>{d.gas_price_median} gwei</dd>
              </>
            )}
          </dl>
        </Section>

        <Section title="Rezerwy w bloku">
          <div className="table-scroll">
            <table className="table reserves" aria-label="Rezerwy w bloku">
              <caption>Rezerwy w bloku</caption>
              <thead>
                <tr>
                  <th>DEX</th>
                  <th className="num">Blok Sync</th>
                  <th className="num">reserve0</th>
                  <th className="num">reserve1</th>
                </tr>
              </thead>
              <tbody>
                {d.reserves.map((r) => (
                  <tr key={r.pool_id}>
                    <td>{r.dex_name}</td>
                    <td className="num">{r.block ?? "—"}</td>
                    <td className="num mono">{r.reserve0 ?? "—"}</td>
                    <td className="num mono">{r.reserve1 ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Cechy">
          <dl className="detail">
            <dt>S (spread)</dt>
            <dd>{d.s.toFixed(3)} %</dd>
            <dt>G (koszt gazu)</dt>
            <dd>{d.g.toFixed(3)} %</dd>
            <dt>L (płynność)</dt>
            <dd>{d.l.toFixed(1)} mln $</dd>
            <dt>M (ryzyko MEV)</dt>
            <dd>{d.m.toFixed(0)} pkt</dd>
          </dl>
        </Section>

        <Section title="Aktywacje reguł Mamdaniego">
          <RuleActivationBars activations={d.rule_activations} />
        </Section>

        <Section title="Baseline">
          <dl className="detail">
            <dt>Optymalna transakcja</dt>
            <dd>{fmtUsd(d.opt_trade_usd)}</dd>
            <dt>Zysk netto est.</dt>
            <dd>{fmtUsd(d.baseline_net_profit_usd)}</dd>
            <dt>Ocena</dt>
            <dd>{d.baseline_feasible == null ? "brak danych" : d.baseline_feasible ? "wykonalna" : "niewykonalna"}</dd>
          </dl>
        </Section>

        <Section title="Weryfikacja retrospektywna">
          {!v ? (
            <p className="muted">niezweryfikowana</p>
          ) : (
            <dl className="detail">
              <dt>Status</dt>
              <dd>
                <Badge tone={STATUS_TONE[v.status]}>{statusLabel(v.status)}</Badge>
              </dd>
              {v.blocks_to_consumption != null && (
                <>
                  <dt>Bloki do konsumpcji</dt>
                  <dd>{v.blocks_to_consumption}</dd>
                </>
              )}
              {v.consumer_tx_hash && (
                <>
                  <dt>Tx konsumująca</dt>
                  <dd>
                    <code className="mono" title={v.consumer_tx_hash}>
                      {shortHash(v.consumer_tx_hash)}
                    </code>{" "}
                    {d.etherscan_url && (
                      <a href={d.etherscan_url} target="_blank" rel="noreferrer">
                        Etherscan ↗
                      </a>
                    )}
                  </dd>
                </>
              )}
              {showProfit && v.route != null && (
                <>
                  <dt>Trasa</dt>
                  <dd>{v.route === "multi" ? "trasa: wielopulowa — zysk nieznany" : "trasa: 2 pule"}</dd>
                </>
              )}
              {isMulti ? (
                <>
                  <dt>Gaz</dt>
                  <dd>
                    {v.gas_used ?? "—"} × cena ⇒ {fmtUsd(v.gas_cost_usd)}
                  </dd>
                  <dt>Zysk realny</dt>
                  <dd>nieznany — tx routowana przez agregator / więcej pul, zysk dwupulowy nie jest policzalny</dd>
                </>
              ) : showProfit ? (
                <>
                  <dt>Zysk realny (brutto)</dt>
                  <dd>{fmtUsd(v.realized_profit_usd)}</dd>
                  <dt>Gaz</dt>
                  <dd>
                    {v.gas_used ?? "—"} × cena ⇒ {fmtUsd(v.gas_cost_usd)}
                  </dd>
                  <dt>Netto</dt>
                  <dd className={net != null && net > 0 ? "profit" : "loss"}>
                    {fmtUsd(net)} — {v.profitable_consumed ? "opłacalna" : "nieopłacalna po gazie"}
                  </dd>
                </>
              ) : (
                <>
                  <dt>Zysk realny</dt>
                  <dd>brak — okazja nie została skonsumowana atomowo (jedną transakcją)</dd>
                </>
              )}
            </dl>
          )}
        </Section>
      </Card>
    </aside>
  );
}
