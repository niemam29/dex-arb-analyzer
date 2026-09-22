// Nagłówek każdego widoku: okruszki, tytuł 20/650, kontekst (np. zakres bloków) i siatka 3–4 KPI
// liczonych przez widok z danych, które i tak pobiera (spec §4). `actions` — np. link „Okazje"
// w widoku Okno.
import type { ReactNode } from "react";
import { Stat, type StatProps } from "./Stat";

export type PageHeaderProps = {
  crumbs: string[];
  title: string;
  context?: ReactNode;
  // `| undefined` jawnie: widoki przekazują `stats={data ? … : undefined}` (exactOptionalPropertyTypes).
  stats?: StatProps[] | undefined;
  actions?: ReactNode;
};

export function PageHeader({ crumbs, title, context, stats, actions }: PageHeaderProps) {
  return (
    <header className="page-head">
      <nav className="crumbs" aria-label="Okruszki">
        {crumbs.map((c, i) => (
          <span key={`${i}-${c}`} className="crumb">
            {i > 0 && <span className="crumb-sep"> / </span>}
            {c}
          </span>
        ))}
      </nav>
      <div className="page-title-row">
        <h2 className="page-title">{title}</h2>
        {actions != null && <div className="page-actions">{actions}</div>}
      </div>
      {context != null && <p className="page-context">{context}</p>}
      {stats && stats.length > 0 && (
        <div className="kpi-grid">
          {stats.map((s) => (
            <Stat key={s.label} {...s} />
          ))}
        </div>
      )}
    </header>
  );
}
