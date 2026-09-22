import type { ReactNode } from "react";
import type { JobDto } from "@dex-arb/shared";

// Pigułka statusu. Mapowania tonów: statusy weryfikacji — STATUS_TONE w
// views/okazje/OpportunityTable.tsx; statusy zadań — JOB_TONE tu (re-eksportowane przez
// views/dane/JobsList.tsx dla starych importów/testów).

export type BadgeTone = "ok" | "warn" | "danger" | "info" | "muted" | "accent";

export type BadgeProps = { tone: BadgeTone; children: ReactNode; title?: string };

export function Badge({ tone, children, title }: BadgeProps) {
  return (
    <span className={`badge badge--${tone}`} title={title}>
      {children}
    </span>
  );
}

export const JOB_TONE: Record<JobDto["status"], BadgeTone> = {
  queued: "muted",
  running: "info",
  done: "ok",
  failed: "danger",
};
