// Test integracyjny handlera import:csv na realnym Postgresie.
// Uruchomienie: DATABASE_URL_TEST=postgres://dexarb:dexarb@localhost:5433/dexarb_test npx vitest run packages/ingest
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { sql } from "drizzle-orm";
import type { JobContext } from "@dex-arb/shared";
import { HAS_DB, resetDb } from "./helpers/db.js";
import { makeImportCsv } from "../src/jobs/import-csv.js";
import { ensureRanges } from "../src/db/ranges.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(TEST_DIR, "fixtures", "events-sample.csv");
// Pełny zewnętrzny events.csv — spoza repozytorium; bez tej zmiennej test jest pomijany.
const FULL_CSV = process.env.REFERENCE_EVENTS_CSV ?? "";
const HAS_FULL_CSV = fs.existsSync(FULL_CSV);

function ctx(): JobContext & { logs: string[]; progresses: number[] } {
  const c = {
    jobId: 1,
    logs: [] as string[],
    progresses: [] as number[],
    signal: new AbortController().signal,
    async log(m: string) {
      c.logs.push(m);
    },
    async progress(p: number) {
      c.progresses.push(p);
    },
  };
  return c;
}

describe.skipIf(!HAS_DB)("import:csv", () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let uni: number, sushi: number;

  beforeAll(() => {
    const conn = createTestDb();
    db = conn.db;
    closeDb = () => conn.sql.end();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    // Pule zasiewane samodzielnie w teście (nie przez skrypt seed) — resetDb daje pulę Uniswap
    // (adres z docs/konwencje.md), tu dokładamy drugą pulę Sushiswap (drugi DEX, ta sama para WETH/USDC).
    const seeded = await resetDb(db);
    uni = seeded.poolId;
    const [sushiDex] = await db
      .insert(schema.dexes)
      .values({ name: "Sushiswap V2", factory: "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac", feeBps: 30 })
      .returning();
    const [pool] = await db.select().from(schema.pools).where(sql`id = ${uni}`);
    const [s] = await db
      .insert(schema.pools)
      .values({
        dexId: sushiDex!.id,
        pairId: pool!.pairId,
        address: "0x397FF1542f962076d0BFE58eA045FfA2d347ACa0",
        token0: pool!.token0,
        token1: pool!.token1,
      })
      .returning();
    sushi = s!.id;
  });

  afterEach(async () => {
    // sprzątanie po każdym teście (w tym po pełnym imporcie) — inne testy dzielą tę samą bazę.
    await db.execute(sql`TRUNCATE sync_events, swap_events RESTART IDENTITY CASCADE`);
  });

  it("importuje sync z rezerwami i swap bez kwot; pomija wiersze z uszkodzonym logIndex; ponowny import niczego nie dubluje", async () => {
    const run = makeImportCsv({ db });
    const c = ctx();
    await run({ path: FIXTURE, poolAliases: { uniswap: uni, sushiswap: sushi } }, c);

    const syncs = await db.select().from(schema.syncEvents);
    const swaps = await db.select().from(schema.swapEvents);
    // fixture: 3 wiersze sync / 3 swap, z czego po 1 parze (logIndex 4294967286/87) uszkodzone → pominięte
    expect(syncs.length).toBe(2);
    expect(swaps.length).toBe(2);

    const u = syncs.find((row) => row.poolId === uni && row.logIndex === 132)!;
    expect(u).toMatchObject({ block: 12429200, logIndex: 132, reserve0: "163737114053377", reserve1: "44004147832345236861057" });
    const w = swaps.find((row) => row.poolId === uni && row.logIndex === 133)!;
    expect(w).toMatchObject({ block: 12429200, logIndex: 133, amount0In: null, sender: null, gasPrice: null });

    // uszkodzony logIndex (przepełnienie uint32, > 1 000 000) NIE trafia do bazy — pominięty, nie zachowany
    expect(syncs.find((row) => row.block === 12429226)).toBeUndefined();
    expect(c.logs.some((m) => /pominięto 2 wierszy z uszkodzonym logIndex/.test(m))).toBe(true);

    // ponowny import: ON CONFLICT DO NOTHING, brak duplikatów
    await run({ path: FIXTURE, poolAliases: { uniswap: uni, sushiswap: sushi } }, ctx());
    expect((await db.select().from(schema.syncEvents)).length).toBe(2);
    expect((await db.select().from(schema.swapEvents)).length).toBe(2);
  });

  it("nieznany alias puli → błąd z numerem linii", async () => {
    await expect(makeImportCsv({ db })({ path: FIXTURE, poolAliases: { uniswap: uni } }, ctx())).rejects.toThrow(/linia 4.*sushiswap/);
  });

  it("blokuje import, gdy pula ma już zakresy w ingest_ranges (dane z RPC — CSV nie może się z nimi mieszać)", async () => {
    await ensureRanges(db, uni, [{ fromBlock: 100, toBlock: 199 }]);
    await expect(
      makeImportCsv({ db })({ path: FIXTURE, poolAliases: { uniswap: uni, sushiswap: sushi } }, ctx()),
    ).rejects.toThrow(new RegExp(`id=${uni}.*ingest_ranges`));

    // nic nie zostało zaimportowane — blokada zadziałała przed przetworzeniem pliku
    expect((await db.select().from(schema.syncEvents)).length).toBe(0);
    expect((await db.select().from(schema.swapEvents)).length).toBe(0);
  });

  // Wyprowadzenie oczekiwanych liczb dla data/events.csv (279 370 wierszy danych) — zgodnie z
  // decyzją ADR 0001: logIndex > 1 000 000 (albo nieskończony/niecałkowity) = uszkodzony,
  // POMIJANY (nie wstawiany — nie poszerzamy log_index do bigint, żeby nie kolidować z docelowym
  // re-ingestem RPC tego samego okna, który da poprawny logIndex dla tych samych bloków).
  //
  //   1) wiersze uszkodzone (logIndex > 1 000 000):
  //      awk -F, 'NR>1 && $2+0 > 1000000 {c++} END{print c+0}' data/events.csv
  //      → 12 004  (potwierdzone: max "sensownego" logIndex w pliku to 1232, min uszkodzonego
  //        to 4 294 967 137 — próg 1 000 000 rozdziela je z dużym marginesem)
  //
  //   2) "sensowne" wiersze (logIndex ≤ 1 000 000) wg typu:
  //      awk -F, 'NR>1 && $2+0 <= 1000000 {print $4}' data/events.csv | sort | uniq -c
  //      → 134 071 sync, 133 295 swap  (suma 267 366 = 279 370 - 12 004 ✓)
  //
  //   3) kolizje klucza głównego (pool,type,block,logIndex) WŚRÓD sensownych wierszy — dwie różne
  //      transakcje (różny tx_hash/rezerwy), którym eksporter źródłowy przypisał ten sam logIndex
  //      w tym samym bloku (usterka niezależna od przepełnienia uint32):
  //      awk -F, 'NR>1 && $2+0 <= 1000000 {print $3","$4","$1","$2}' data/events.csv \
  //        | sort | uniq -c | awk '$1>1{extra+=$1-1; groups++} END{print groups+0, extra+0}'
  //      → 182 grupy / 182 nadmiarowe wiersze, z podziałem wg typu 92 sync / 90 swap
  //
  //   4) oczekiwane po imporcie: 134 071 - 92 = 133 979 sync, 133 295 - 90 = 133 205 swap,
  //      razem 267 184 (ADR 0001).
  it.skipIf(!HAS_FULL_CSV)(
    "pełny import data/events.csv: 12 004 uszkodzonych logIndex pominięte, 267 184 zdarzeń wstawionych (133 979 sync + 133 205 swap) po odrzuceniu 182 kolizji klucza",
    async () => {
      const c = ctx();
      const start = Date.now();
      await makeImportCsv({ db })({ path: FULL_CSV, poolAliases: { uniswap: uni, sushiswap: sushi } }, c);
      console.log(`import pełnego CSV: ${Date.now() - start} ms`);

      const [r] = await db.execute<{ sync: string; swap: string }>(
        sql`SELECT (SELECT count(*) FROM sync_events) AS sync, (SELECT count(*) FROM swap_events) AS swap`,
      );
      expect(Number(r!.sync)).toBe(133_979);
      expect(Number(r!.swap)).toBe(133_205);
      expect(Number(r!.sync) + Number(r!.swap)).toBe(267_184);
      expect(c.progresses.at(-1)).toBe(1);

      // dokładna liczba pominiętych uszkodzonych wierszy i kolizji klucza — zgodnie z awk powyżej
      expect(c.logs.some((m) => /pominięto 12004 wierszy z uszkodzonym logIndex/.test(m))).toBe(true);
      expect(
        c.logs.some((m) =>
          /oczekiwano 134071 sync \/ 133295 swap, wstawiono 133979 sync \/ 133205 swap \(odrzucono 92 sync, 90 swap\)/.test(m),
        ),
      ).toBe(true);
    },
    300_000,
  );
});
