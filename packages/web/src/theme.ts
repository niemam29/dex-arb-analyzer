// packages/web/src/theme.ts
// Jedyne źródło kolorów dla wykresów (Recharts wymaga wartości, nie `var()`): czytamy custom
// properties z `:root` (styles.css) przez getComputedStyle, a gdy nie są ustawione (jsdom/testy,
// podgląd bez CSS) — fallback na te same heksy. Odczyt jest LENIWY (gettery), bo w dev Vite
// wstrzykuje styles.css po ewaluacji modułów importowanych z main.tsx.
export const TOKEN_FALLBACK = {
  "--bg": "#f6f7f9",
  "--surface": "#ffffff",
  "--border": "#e5e7eb",
  "--border-soft": "#eef0f2",
  "--fg": "#1f2937",
  "--fg-muted": "#6b7280",
  "--accent": "#4f46e5",
  "--accent-soft": "#eef2ff",
  "--accent-fg": "#3730a3",
  "--ok": "#16a34a",
  "--ok-soft": "#dcfce7",
  "--ok-fg": "#166534",
  "--warn": "#d97706",
  "--warn-soft": "#fef3c7",
  "--warn-fg": "#92400e",
  "--danger": "#dc2626",
  "--danger-soft": "#fee2e2",
  "--danger-fg": "#991b1b",
  "--info": "#2563eb",
  "--info-soft": "#dbeafe",
  "--info-fg": "#1e40af",
  "--muted-soft": "#f3f4f6",
  "--model-baseline": "#6b7280",
  "--model-mamdani": "#d97706",
  "--model-baseline-v2": "#0d9488",
  "--model-anfis": "#4f46e5",
  "--pool-a": "#e11d48",
  "--pool-b": "#2563eb",
} as const;

export type TokenName = keyof typeof TOKEN_FALLBACK;

export function cssVar(name: TokenName): string {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return TOKEN_FALLBACK[name];
  const v = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || TOKEN_FALLBACK[name];
}

function live<K extends string>(map: Record<K, TokenName>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of Object.keys(map) as K[]) {
    Object.defineProperty(out, key, { enumerable: true, get: () => cssVar(map[key]) });
  }
  return out;
}

export const MODEL_COLORS = live({
  baseline: "--model-baseline",
  baseline_v2: "--model-baseline-v2",
  mamdani: "--model-mamdani",
  anfis: "--model-anfis",
});

export const POOL_COLORS = live({ a: "--pool-a", b: "--pool-b" });

/** Kolor po `kind` modelu (string z API); nieznany kind -> szary `--fg-muted`. */
export function modelColor(kind: string): string {
  return kind in MODEL_COLORS ? MODEL_COLORS[kind as keyof typeof MODEL_COLORS] : cssVar("--fg-muted");
}
