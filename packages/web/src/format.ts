// packages/web/src/format.ts
// Wspólne formatery liczb dla całego dashboardu (pl-PL). Do 2026-08 `fmtUsd`/`fmtPct` żyły w
// views/okazje/OpportunityTable.tsx — tamten plik re-eksportuje je stąd, żeby stare importy
// działały. Bloki (`fmtBlock`) celowo BEZ grupowania tysięcy: numer bloku to identyfikator, który
// użytkownik kopiuje do Etherscana, nie wielkość.
const PL = "pl-PL";

export const fmtUsd = (v: number | null | undefined): string =>
  v == null ? "—" : v.toLocaleString(PL, { maximumFractionDigits: 2 }) + " $";

export const fmtPct = (v: number, digits = 3): string =>
  v.toLocaleString(PL, { minimumFractionDigits: digits, maximumFractionDigits: digits }) + " %";

export const fmtInt = (v: number | null | undefined): string => (v == null ? "—" : v.toLocaleString(PL, { maximumFractionDigits: 0 }));

export const fmtBlock = (b: number | null | undefined): string => (b == null ? "—" : String(b));

/** `0x1234…abcd` — zachowuje `keep` znaków po `0x` i `keep` z końca; krótkie hashe bez zmian. */
export function shortHash(h: string, keep = 6): string {
  if (h.length <= 2 + keep * 2) return h;
  return `${h.slice(0, 2 + keep)}…${h.slice(-keep)}`;
}

/** Mediana (dla KPI liczonych z pobranej strony/serii); pusta tablica -> null. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const dec = (v: number, digits: number): string => v.toFixed(digits).replace(".", ",");

/** AUC z 95 % przedziałem ufności: `0,818 [0,79–0,85]`. Bez CI (null) sam AUC; brak AUC -> myślnik. */
export function fmtAucCi(auc: number | null | undefined, ci: [number, number] | null | undefined): string {
  if (auc == null) return "—";
  return ci ? `${dec(auc, 3)} [${dec(ci[0], 2)}–${dec(ci[1], 2)}]` : dec(auc, 3);
}

/** Znaczniki czasu w UI ZAWSZE w UTC z etykietą (dane on-chain są w UTC; strefa maszyny użytkownika nie ma tu znaczenia). */
export function fmtDateUtc(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}
