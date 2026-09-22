// Pusty stan (brak zadań, nie wybrano okazji, brak stanów bloków) — tytuł, opcjonalna podpowiedź
// i akcja.
import type { ReactNode } from "react";

export type EmptyStateProps = { title: string; hint?: ReactNode; action?: ReactNode };

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {hint != null && <p className="empty-hint">{hint}</p>}
      {action != null && <div className="empty-action">{action}</div>}
    </div>
  );
}
