// Test integracyjny szkieletu API: /health + obsługa nieznanej trasy.
// Uruchomienie: DATABASE_URL_TEST=... npx vitest run packages/api (patrz root package.json).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { HAS_DB, testDb, type TestDb } from "./helpers/db.js";

let t: TestDb;
let app: ReturnType<typeof buildApp>;

describe.skipIf(!HAS_DB)("api: app (DATABASE_URL_TEST)", () => {
  beforeAll(async () => {
    t = await testDb();
    app = buildApp({ db: t.db });
    await t.reset();
  });
  afterAll(async () => {
    await app.close();
    await t.close();
  });

  describe("app", () => {
    it("GET /health → 200 {ok:true}", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it("nieznana trasa → 404 JSON", async () => {
      const res = await app.inject({ method: "GET", url: "/nope" });
      expect(res.statusCode).toBe(404);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.json()).toHaveProperty("error");
    });
  });
});
