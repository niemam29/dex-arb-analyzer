import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { apiGet, type ApiError } from "./client";

afterEach(() => vi.restoreAllMocks());

describe("apiGet", () => {
  it("parsuje odpowiedź schematem", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(apiGet("/health", z.object({ ok: z.boolean() }))).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith("/api/health", expect.anything());
  });
  it("rzuca ApiError z komunikatem serwera przy 4xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "Brak okna" }), { status: 404 }));
    await expect(apiGet("/x", z.any())).rejects.toMatchObject({ status: 404, message: "Brak okna" } satisfies Partial<ApiError>);
  });
  it("rzuca ApiError 502, gdy odpowiedź 200 nie zgadza się ze schematem", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: "nope" }), { status: 200 }));
    expect.assertions(2);
    try {
      await apiGet("/health", z.object({ ok: z.boolean() }));
    } catch (e) {
      const err = e as ApiError;
      expect(err).toMatchObject({ status: 502, message: "Niezgodna odpowiedź API" } satisfies Partial<ApiError>);
      expect(Array.isArray((err.body as { issues?: unknown }).issues)).toBe(true);
    }
  });
});
