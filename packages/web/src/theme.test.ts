// packages/web/src/theme.test.ts
// Kolory modeli/pul dla Recharts: z `getComputedStyle(document.documentElement)` (Recharts nie
// rozumie `var()`), a gdy custom property nie jest ustawiona (jsdom, brak CSS) — fallback na te
// same heksy co w styles.css.
import { it, expect, vi, afterEach } from "vitest";
import { cssVar, MODEL_COLORS, POOL_COLORS, modelColor } from "./theme";

afterEach(() => vi.restoreAllMocks());

it("cssVar w jsdom (brak CSS) zwraca fallback heks", () => {
  expect(cssVar("--model-mamdani")).toBe("#d97706");
  expect(cssVar("--pool-a")).toBe("#e11d48");
  expect(cssVar("--fg-muted")).toBe("#6b7280");
});

it("cssVar czyta wartość z getComputedStyle, gdy jest ustawiona", () => {
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: (name: string) => (name === "--model-anfis" ? " #123456 " : ""),
  } as unknown as CSSStyleDeclaration);
  expect(cssVar("--model-anfis")).toBe("#123456");
  expect(cssVar("--model-baseline")).toBe("#6b7280");
});

it("MODEL_COLORS/POOL_COLORS są odczytywane leniwie (gettery), modelColor ma fallback dla nieznanego kind", () => {
  expect(MODEL_COLORS.baseline).toBe("#6b7280");
  expect(MODEL_COLORS.baseline_v2).toBe("#0d9488");
  expect(MODEL_COLORS.mamdani).toBe("#d97706");
  expect(MODEL_COLORS.anfis).toBe("#4f46e5");
  expect(POOL_COLORS.a).toBe("#e11d48");
  expect(POOL_COLORS.b).toBe("#2563eb");
  expect(modelColor("anfis")).toBe("#4f46e5");
  expect(modelColor("cokolwiek")).toBe("#6b7280");
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: (name: string) => (name === "--model-anfis" ? "#000000" : ""),
  } as unknown as CSSStyleDeclaration);
  expect(MODEL_COLORS.anfis).toBe("#000000");
});
