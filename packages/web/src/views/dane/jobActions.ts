// Helper czysty — decyduje, jakie zadania kolejki zlecić dla danej akcji przycisku w tabeli
// pokrycia (`CoverageTable`). `ingest` → jedno zadanie na pulę pary (żeby każda pula miała
// własny postęp/log w liście zadań), `analyze`/`verify` → jedno na parę+okno.
import type { JobCreate, PairDto, WindowDto } from "@dex-arb/shared";

export type ActionKind = "ingest" | "analyze" | "verify";

export function jobsForAction(kind: ActionKind, pair: PairDto, win: WindowDto): JobCreate[] {
  if (kind === "ingest") {
    return pair.pools.map((p) => ({
      type: "ingest:pool-window" as const,
      params: { poolId: p.id, windowId: win.id },
    }));
  }
  if (kind === "analyze") {
    return [{ type: "analyze:pair-window" as const, params: { pairId: pair.id, windowId: win.id } }];
  }
  // `force: true` zawsze ("always-true" zamiast warunkowego "tylko gdy komórka ma już
  // weryfikacje") — `verify:pair-window` jest
  // idempotentny (ON CONFLICT DO UPDATE w `upsertVerifications`), a przycisk "Weryfikuj" w
  // tabeli pokrycia nie zna liczby istniejących weryfikacji komórki (`CoverageTable` woła
  // `onAction("verify", pair, win)` bez tego licznika) — dociąganie go tylko po to, żeby
  // warunkowo ustawić `force`, dodałoby zależność bez korzyści: bez `force` klik "Weryfikuj" na
  // już w pełni zweryfikowanej komórce byłby cichym no-opem (`skipVerified` domyślnie true w
  // handlerze), co dla użytkownika klikającego przycisk wygląda jak błąd.
  return [{ type: "verify:pair-window" as const, params: { pairId: pair.id, windowId: win.id, force: true } }];
}
