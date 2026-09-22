import type { ReactNode } from "react";

// Biała karta z opcjonalnym nagłówkiem (tytuł + szary kontekst po prawej + akcje). `padded={false}`
// (klasa card--flush) dla kart z tabelą — wtedy .table-scroll dotyka krawędzi karty.

export type CardProps = {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  padded?: boolean;
  className?: string;
  children?: ReactNode;
};

export function Card({ title, meta, actions, padded = true, className, children }: CardProps) {
  const cls = ["card", padded ? "" : "card--flush", className ?? ""].filter(Boolean).join(" ");
  const hasHead = title != null || meta != null || actions != null;
  return (
    <section className={cls}>
      {hasHead && (
        <header className="card-head">
          {title != null && <h3 className="card-title">{title}</h3>}
          {meta != null && <span className="card-meta">{meta}</span>}
          {actions != null && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}
