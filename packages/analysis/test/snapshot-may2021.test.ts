// Snapshot regresyjny na PRAWDZIWEJ bazie deweloperskiej (nie DATABASE_URL_TEST): sprawdza, że
// przebieg analizy pary WETH/USDC ("2021-05 krach", pair=1, window=2) po ingest RPC ma stałe,
// znane liczby. Tylko SELECT-y — nigdy INSERT/UPDATE/DELETE. Pomijany bez SNAPSHOT_DATABASE_URL
// (celowo osobna zmienna od DATABASE_URL_TEST, żeby nie dało się uruchomić przez pomyłkę razem
// z resztą pakietu testów integracyjnych, które robią TRUNCATE). Uruchomienie: patrz docs/konwencje.md,
// sekcja „Etap 2".
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createDb, schema, type Db } from "@dex-arb/db";
import { and, count, eq } from "drizzle-orm";

const PAIR_ID = 1;
const WINDOW_ID = 2;

describe.skipIf(!process.env.SNAPSHOT_DATABASE_URL)(
  "snapshot: WETH/USDC, okno „2021-05 krach” (pair=1, window=2), baza dev — read-only",
  () => {
    let db: Db;
    let closeDb: () => Promise<void>;

    beforeAll(() => {
      const conn = createDb(process.env.SNAPSHOT_DATABASE_URL);
      db = conn.db;
      closeDb = () => conn.sql.end();
    });

    afterAll(async () => {
      await closeDb();
    });

    it("block_states: 77 387 wierszy", async () => {
      const [row] = await db
        .select({ n: count() })
        .from(schema.blockStates)
        .where(and(eq(schema.blockStates.pairId, PAIR_ID), eq(schema.blockStates.windowId, WINDOW_ID)));
      expect(row!.n).toBe(77_387);
    });

    it("opportunities: 657 wierszy", async () => {
      const [row] = await db
        .select({ n: count() })
        .from(schema.opportunities)
        .where(and(eq(schema.opportunities.pairId, PAIR_ID), eq(schema.opportunities.windowId, WINDOW_ID)));
      expect(row!.n).toBe(657);
    });

    it("model_scores (mamdani v1): rozkład etykiet 76 945 niewykonalna / 427 ryzykowna / 14 wykonalna / 1 atrakcyjna", async () => {
      const [mamdani] = await db
        .select({ id: schema.scoringModels.id })
        .from(schema.scoringModels)
        .where(and(eq(schema.scoringModels.name, "mamdani"), eq(schema.scoringModels.version, 1)));
      expect(mamdani, "brak wiersza scoring_models dla mamdani v1 — uruchom najpierw analyzePairWindow").toBeDefined();

      const rows = await db
        .select({ label: schema.modelScores.label, n: count() })
        .from(schema.modelScores)
        .where(and(eq(schema.modelScores.modelId, mamdani!.id), eq(schema.modelScores.pairId, PAIR_ID)))
        .groupBy(schema.modelScores.label);
      const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.n]));

      expect(byLabel["niewykonalna"] ?? 0).toBe(76_945);
      expect(byLabel["ryzykowna"] ?? 0).toBe(427);
      expect(byLabel["wykonalna"] ?? 0).toBe(14);
      expect(byLabel["atrakcyjna"] ?? 0).toBe(1);
    });
  },
);
