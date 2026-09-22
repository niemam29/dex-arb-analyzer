// Test jednostkowy handlera błędów: rozróżnienie HttpError
// (walidacja WEJŚCIA przez parseOr400 → 400) od gołego ZodError (niezgodność kontraktu
// WYJŚCIA, np. `PairList.parse(rows)` w catalog.ts, → 500, bez ujawniania szczegółów zod
// klientowi). Nie dotyka bazy danych — `db` jest atrapą, trasy testowe nic nie odpytują.
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Db } from "@dex-arb/db";
import { buildApp } from "../src/app.js";
import { parseOr400 } from "../src/plugins/zod.js";

const app = buildApp({ db: {} as Db });

// Trasy testowe rejestrowane raz, przy zbieraniu testów (przed pierwszym `inject`).
app.get("/test/contract-violation", async () => {
  // Symuluje niezgodność SQL ↔ DTO wewnątrz handlera trasy — goły ZodError, NIE przez parseOr400.
  return z.object({ foo: z.string() }).parse({ foo: 123 });
});

app.get("/test/input-validation", async () => {
  // Walidacja danych WEJŚCIOWYCH przez parseOr400 → rzuca HttpError(400, ...).
  return parseOr400(z.object({ bar: z.string() }), { bar: 123 });
});

afterAll(async () => {
  await app.close();
});

describe("obsługa błędów", () => {
  it("goły ZodError (niezgodność kontraktu odpowiedzi) → 500, bez szczegółów zod w body", async () => {
    const res = await app.inject({ method: "GET", url: "/test/contract-violation" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Niezgodność kontraktu odpowiedzi" });
  });

  it("HttpError z parseOr400 (walidacja wejścia) → 400 z listą issues", async () => {
    const res = await app.inject({ method: "GET", url: "/test/input-validation" });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("Niepoprawne dane wejściowe");
    expect(body.issues).toBeDefined();
  });
});
