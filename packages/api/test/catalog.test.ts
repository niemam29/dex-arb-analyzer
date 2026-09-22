// Test integracyjny tras katalogowych: GET /pairs, /windows, /models.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PairList, WindowList, ModelList } from "@dex-arb/shared";
import { buildApp } from "../src/app.js";
import { HAS_DB, testDb, type TestDb } from "./helpers/db.js";

let t: TestDb;
let app: ReturnType<typeof buildApp>;

describe.skipIf(!HAS_DB)("api: catalog (DATABASE_URL_TEST)", () => {
  beforeAll(async () => {
    t = await testDb();
    app = buildApp({ db: t.db });
    await t.reset();
    await t.seedCatalog();
  });
  afterAll(async () => {
    await app.close();
    await t.close();
  });

  describe("katalog", () => {
    it("GET /pairs zwraca pary z pulami i nazwą DEX-a", async () => {
      const res = await app.inject({ method: "GET", url: "/pairs" });
      expect(res.statusCode).toBe(200);
      const pairs = PairList.parse(res.json());
      expect(pairs).toHaveLength(1);
      expect(pairs[0]!.symbol).toBe("WETH/USDC");
      expect(pairs[0]!.pools.map((p) => p.dex_name).sort()).toEqual(["Sushiswap", "Uniswap V2"]);
    });

    it("GET /windows zwraca okna z blokami", async () => {
      const res = await app.inject({ method: "GET", url: "/windows" });
      expect(res.statusCode).toBe(200);
      const w = WindowList.parse(res.json());
      expect(w[0]).toMatchObject({ name: "test-okno", from_block: 1000, to_block: 1999 });
    });

    it("GET /models zwraca modele", async () => {
      const res = await app.inject({ method: "GET", url: "/models" });
      expect(res.statusCode).toBe(200);
      const m = ModelList.parse(res.json());
      expect(m[0]).toMatchObject({ name: "baseline", kind: "baseline" });
    });
  });
});
