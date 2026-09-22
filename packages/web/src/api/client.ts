import type { ZodSchema } from "zod";

export const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response, schema: ZodSchema<T>): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body && typeof body.error === "string" ? body.error : `HTTP ${res.status}`, body);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Odpowiedź serwera nie zgadza się ze schematem DTO — traktujemy jak błąd sieciowy/
    // kontraktu (502), a nie osobny kształt wyjątku, żeby wywołujący obsługiwali jeden typ
    // błędu (ApiError) niezależnie od tego, czy zawiódł status HTTP, czy walidacja zod.
    throw new ApiError(502, "Niezgodna odpowiedź API", { issues: parsed.error.issues });
  }
  return parsed.data;
}

export function apiGet<T>(path: string, schema: ZodSchema<T>): Promise<T> {
  return fetch(API_BASE + path, { headers: { Accept: "application/json" } }).then((r) => handle(r, schema));
}

export function apiPost<T>(path: string, body: unknown, schema: ZodSchema<T>): Promise<T> {
  return fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  }).then((r) => handle(r, schema));
}
