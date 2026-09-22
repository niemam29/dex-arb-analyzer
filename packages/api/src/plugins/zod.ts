// Mapowanie błędów walidacji zod na odpowiedzi HTTP 400.
import type { ZodType } from "zod";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public issues?: unknown,
  ) {
    super(message);
  }
}

/** Parsuje `data` schematem `schema`; przy błędzie rzuca `HttpError(400, ...)` z listą issues. */
export function parseOr400<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new HttpError(400, "Niepoprawne dane wejściowe", r.error.flatten());
  }
  return r.data;
}

export { ZodError };
