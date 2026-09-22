// Test jednostkowy zamykania aplikacji: `sql` przekazany do
// `buildApp` rejestruje hook `onClose`, więc `app.close()` sam zamyka połączenie z bazą —
// server.ts (SIGINT/SIGTERM) polega na tym, wywołując tylko `app.close()`. Atrapa `sql.end`
// zamiast realnego klienta postgres — test nie dotyka bazy danych.
import { describe, expect, it, vi } from "vitest";
import type { Db } from "@dex-arb/db";
import { buildApp } from "../src/app.js";

describe("zamykanie aplikacji", () => {
  it("app.close() rozwiązuje się i wywołuje zarejestrowany hook onClose (zamknięcie sql)", async () => {
    const end = vi.fn().mockResolvedValue(undefined);
    const app = buildApp({ db: {} as Db, sql: { end } });

    await expect(app.close()).resolves.toBeUndefined();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("bez `sql` app.close() działa normalnie (hook nie rejestrowany)", async () => {
    const app = buildApp({ db: {} as Db });
    await expect(app.close()).resolves.toBeUndefined();
  });
});
