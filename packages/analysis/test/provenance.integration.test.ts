// Test integracyjny `collectProvenance` — zbiera git SHA/wersje/host RPC + liczności per okno
// (block_states/opportunities/verified) w chwili wywołania (patrz ADR 0008: liczności okien
// zmieniają się po każdym re-ingeście/reweryfikacji, więc bez tego bloku tabela wyników w pracy
// jest nieodtwarzalna).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { ProvenanceSchema } from "@dex-arb/shared";
import { collectProvenance } from "../src/provenance.js";
import { HAS_DB, resetDb } from "./helpers/db.js";

describe.skipIf(!HAS_DB)("collectProvenance (DATABASE_URL_TEST)", () => {
  let db: Db;
  let close: () => Promise<unknown>;
  let windowId: number;
  let pairId: number;

  beforeAll(async () => {
    const conn = createTestDb();
    db = conn.db;
    close = () => conn.sql.end();
    const seeded = await resetDb(db);
    pairId = seeded.pairId;
    const [w] = await db.insert(schema.windows).values({ name: "prov-okno", fromTs: new Date("2021-05-14T00:00:00Z"), toTs: new Date("2021-05-15T00:00:00Z"), fromBlock: 100, toBlock: 199 }).returning();
    windowId = w!.id;
    const bs = (block: number) => ({ pairId, windowId, block, priceA: 1, priceB: 1, spreadPct: 1, tvlMinUsd: 1, s: 1, g: 0, l: 1, m: 0 });
    await db.insert(schema.blockStates).values([bs(100), bs(101), bs(102)]);
    const [o] = await db.insert(schema.opportunities).values({ pairId, windowId, block: 101, spreadPct: 1, direction: "a_to_b" }).returning();
    await db.insert(schema.opportunityVerifications).values({ opportunityId: o!.id, status: "decayed" });
  });
  afterAll(async () => {
    await close();
  });

  it("zbiera sha/wersje/host i liczności per okno; przechodzi ProvenanceSchema", async () => {
    const started = Date.now() - 1500;
    const p = await collectProvenance(db, [windowId], started);
    expect(() => ProvenanceSchema.parse(p)).not.toThrow();
    expect(p.gitSha).toMatch(/^[0-9a-f]{40}$|^unknown$/);
    expect(p.deps["drizzle-orm"]).toMatch(/^\d/);
    expect(p.windows).toEqual([{ id: windowId, fromBlock: 100, toBlock: 199, blockStates: 3, opportunities: 1, verified: 1 }]);
    expect(p.durationMs).toBeGreaterThanOrEqual(1500);
    expect(p.rpcHost === null || /^[A-Za-z0-9.-]+$/.test(p.rpcHost)).toBe(true);
  });
});
