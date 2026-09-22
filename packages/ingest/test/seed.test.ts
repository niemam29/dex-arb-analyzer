// Testy integracyjne runSeed na realnym Postgresie z zamockowanym RPC.
// Uruchomienie: DATABASE_URL_TEST=postgres://dexarb:dexarb@localhost:5433/dexarb_test npx vitest run packages/ingest
// Bez DATABASE_URL_TEST cały opis jest pomijany (describe.skipIf) — bezpieczne na CI bez usługi bazy.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, schema, type Db } from "@dex-arb/db";
import { sql as sqlOp } from "drizzle-orm";
import { HAS_DB } from "./helpers/db.js";
import { runSeed, type RpcLike } from "../src/seed.js";
import { DEXES, TOKENS, PAIRS, POOLS, getPairCalldata } from "../src/seed-data.js";

async function truncateAll(db: Db): Promise<void> {
  await db.execute(
    sqlOp`TRUNCATE sync_events, swap_events, blocks, ingest_ranges, jobs, windows, pools, pairs, tokens, dexes RESTART IDENTITY CASCADE`,
  );
}

const encodeAddressWord = (addr: string): string => "0x" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");

const tokenBySymbol = Object.fromEntries(TOKENS.map((t) => [t.symbol, t.address] as const));
const token0Selector = "0x0dfe1681"; // token0()
const token1Selector = "0xd21220a7"; // token1()

/**
 * Zamockowany RPC: odpowiada na eth_call getPair()/token0()/token1() zgodnie z danymi w POOLS/PAIRS
 * z seed-data.ts — symuluje factory i pule bez sieci. Rzuca, gdy zapyta o coś spoza tych danych.
 */
function mockRpc(overrides: { poolAddress?: (dex: string, pair: string) => string } = {}): RpcLike {
  const calldataToAddress = new Map<string, string>();
  for (const dex of DEXES) {
    for (const pair of PAIRS) {
      const pool = POOLS.find((p) => p.dex === dex.name && p.pair === pair.symbol);
      if (!pool?.address) continue;
      const address = overrides.poolAddress ? overrides.poolAddress(dex.name, pair.symbol) : pool.address;
      const cd = getPairCalldata(tokenBySymbol[pair.base]!, tokenBySymbol[pair.quote]!);
      calldataToAddress.set(`${dex.factory.toLowerCase()}|${cd}`, address);
    }
  }
  const token01ByPool = new Map<string, [string, string]>();
  for (const pair of PAIRS) {
    const sorted = [tokenBySymbol[pair.base]!, tokenBySymbol[pair.quote]!].sort((a, b) =>
      a.toLowerCase() < b.toLowerCase() ? -1 : 1,
    ) as [string, string];
    for (const dex of DEXES) {
      const pool = POOLS.find((p) => p.dex === dex.name && p.pair === pair.symbol);
      if (pool?.address) token01ByPool.set(pool.address.toLowerCase(), sorted);
    }
  }

  async function handleCall(method: string, params: unknown[]): Promise<unknown> {
    // runSeed(verify:true) po pętli po POOLS wywołuje resolveWindowBlocks (weryfikacja bloków
    // okien) — ten test nie sprawdza tej ścieżki (weryfikacja pul), więc odpowiadamy formułą
    // czasu bloku wystarczającą, by binary search zbiegł, bez odwzorowania realnych bloków.
    if (method === "eth_blockNumber") return "0x1000000";
    if (method === "eth_getBlockByNumber") {
      const n = Number(BigInt(params[0] as string));
      return { number: params[0], timestamp: "0x" + (n * 100).toString(16), transactions: [] };
    }
    if (method !== "eth_call") throw new Error("mockRpc: nieoczekiwana metoda " + method);
    const { to, data } = params[0] as { to: string; data: string };
    const getPairResult = calldataToAddress.get(`${to.toLowerCase()}|${data}`);
    if (getPairResult) return encodeAddressWord(getPairResult);
    if (data.startsWith(token0Selector) || data.startsWith(token1Selector)) {
      const t01 = token01ByPool.get(to.toLowerCase());
      if (!t01) throw new Error("mockRpc: nieznana pula " + to);
      return encodeAddressWord(data.startsWith(token0Selector) ? t01[0] : t01[1]);
    }
    throw new Error(`mockRpc: nieoczekiwane wywołanie to=${to} data=${data}`);
  }

  return {
    async call<T>(method: string, params: unknown[]): Promise<T> {
      return handleCall(method, params) as unknown as T;
    },
    async batch<T>(reqs: { method: string; params: unknown[] }[]): Promise<T[]> {
      return Promise.all(reqs.map((r) => handleCall(r.method, r.params))) as unknown as Promise<T[]>;
    },
  };
}

describe.skipIf(!HAS_DB)("runSeed", () => {
  let db: Db;
  let closeDb: () => Promise<void>;

  beforeAll(() => {
    const conn = createTestDb();
    db = conn.db;
    closeDb = () => conn.sql.end();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  it("bez --verify: wypełnia bazę zgodnie z SEED (2 dexy, 5 tokenów, 4 pary, 8 pul, 4 okna), idempotentnie", async () => {
    const r1 = await runSeed(db, null, { verify: false });
    expect(r1).toHaveLength(8);
    expect(r1.every((r) => r.status === "OK" && r.inserted)).toBe(true);

    expect((await db.select().from(schema.dexes)).length).toBe(2);
    expect((await db.select().from(schema.tokens)).length).toBe(5);
    expect((await db.select().from(schema.pairs)).length).toBe(4);
    expect((await db.select().from(schema.pools)).length).toBe(8);
    expect((await db.select().from(schema.windows)).length).toBe(4);

    // ponowne uruchomienie: bez błędu i bez duplikatów
    const r2 = await runSeed(db, null, { verify: false });
    expect(r2.every((r) => r.inserted === false)).toBe(true);
    expect((await db.select().from(schema.pools)).length).toBe(8);
    expect((await db.select().from(schema.dexes)).length).toBe(2);
  });

  it("z --verify: adres i token0/token1 pochodzą z RPC (getPair/token0/token1), token0=USDC dla WETH/USDC", async () => {
    const results = await runSeed(db, mockRpc(), { verify: true });
    expect(results).toHaveLength(8);
    for (const r of results) {
      expect(["OK", "NEW"]).toContain(r.status);
      expect(r.address).toBeTruthy();
    }
    const uniWethUsdc = results.find((r) => r.dex === "uniswap-v2" && r.pair === "WETH/USDC")!;
    expect(uniWethUsdc.token0.toLowerCase()).toBe(tokenBySymbol.USDC!.toLowerCase());
    expect(uniWethUsdc.token1.toLowerCase()).toBe(tokenBySymbol.WETH!.toLowerCase());

    const pools = await db.select().from(schema.pools);
    expect(pools.length).toBe(8);
  });

  it("z --verify: adres w SEED niezgodny z on-chain rzuca błąd po polsku", async () => {
    const badAddress = "0x0000000000000000000000000000000000dEaD";
    await expect(runSeed(db, mockRpc({ poolAddress: () => badAddress }), { verify: true })).rejects.toThrow(/on-chain/);
  });

  it("niezgodność on-chain na 3. puli (fix rundy poprawek 2) wycofuje CAŁĄ transakcję — baza zostaje nietknięta", async () => {
    // POOLS[2] = uniswap-v2 WETH/USDT — pierwsze dwie pule (uniswap-v2 i sushiswap WETH/USDC)
    // przechodzą weryfikację poprawnie, dopiero trzecia dostaje zły adres z factory.getPair.
    // Przed fix-em (bez transakcji) dexy/tokeny/pary/okna i pierwsze 2 pule zostałyby zapisane
    // mimo rzuconego błędu — teraz cały seed musi być atomowy.
    const badAddress = "0x0000000000000000000000000000000000dEaD";
    const rpc = mockRpc({
      poolAddress: (dex, pair) =>
        dex === "uniswap-v2" && pair === "WETH/USDT" ? badAddress : POOLS.find((p) => p.dex === dex && p.pair === pair)!.address!,
    });

    await expect(runSeed(db, rpc, { verify: true })).rejects.toThrow(/on-chain/);

    expect((await db.select().from(schema.dexes)).length).toBe(0);
    expect((await db.select().from(schema.tokens)).length).toBe(0);
    expect((await db.select().from(schema.pairs)).length).toBe(0);
    expect((await db.select().from(schema.windows)).length).toBe(0);
    expect((await db.select().from(schema.pools)).length).toBe(0);
  });

  it("runSeed(verify:true, rpc:null) odmawia — verify wymaga klienta RPC", async () => {
    await expect(runSeed(db, null, { verify: true })).rejects.toThrow(/wymaga przekazania klienta RPC/);
  });

  it("łączy pule z właściwą parą PO SYMBOLU, nie po pierwszym wierszu tabeli pairs", async () => {
    // Wstawiamy obcą parę PRZED seedem, żeby dostała niższe id niż WETH/USDC — gdyby runSeed
    // brał "pierwszy wiersz" zamiast filtrować po symbolu, złapałby właśnie tę parę.
    await db.insert(schema.tokens).values([
      { address: "0x1111111111111111111111111111111111111111", symbol: "FOO", decimals: 18 },
      { address: "0x2222222222222222222222222222222222222222", symbol: "BAR", decimals: 18 },
    ]);
    await db.insert(schema.pairs).values({
      symbol: "FOO/BAR",
      tokenBase: "0x1111111111111111111111111111111111111111",
      tokenQuote: "0x2222222222222222222222222222222222222222",
    });

    await runSeed(db, null, { verify: false });

    const pairs = await db.select().from(schema.pairs);
    const dexes = await db.select().from(schema.dexes);
    const wethUsdcPair = pairs.find((p) => p.symbol === "WETH/USDC")!;
    const uniDex = dexes.find((d) => d.name === "uniswap-v2")!;
    const pools = await db.select().from(schema.pools);
    const pool = pools.find((p) => p.dexId === uniDex.id && p.pairId === wethUsdcPair.id);

    expect(pool).toBeDefined();
    expect(pool!.address.toLowerCase()).toBe(POOLS[0]!.address!.toLowerCase());
    expect(wethUsdcPair.symbol).not.toBe("FOO/BAR");
  });

  it("aktualizuje w miejscu nieświeże wiersze (Stage-0 lub wcześniejszy przebieg) zamiast zostawiać je bez zmian lub duplikować", async () => {
    // symulacja bazy zaseedowanej wcześniej (np. usuniętym packages/db/src/seed.ts) z tymi samymi
    // kluczami naturalnymi (name/symbol/address), ale nieświeżymi/błędnymi wartościami w innych
    // kolumnach — runSeed musi je NADPISAĆ (ON CONFLICT DO UPDATE), nie zostawić ani zduplikować.
    const [dex] = await db
      .insert(schema.dexes)
      .values({ name: "uniswap-v2", factory: "0x0000000000000000000000000000000000dead", feeBps: 99 })
      .returning();
    await db.insert(schema.tokens).values(TOKENS.map((t) => ({ ...t })));
    const [pair] = await db
      .insert(schema.pairs)
      .values({ symbol: "WETH/USDC", tokenBase: tokenBySymbol.WETH!, tokenQuote: tokenBySymbol.USDC! })
      .returning();
    await db.insert(schema.windows).values({
      name: "2021-05 krach",
      fromTs: new Date("2000-01-01T00:00:00Z"),
      toTs: new Date("2000-01-02T00:00:00Z"),
    });
    await db.insert(schema.pools).values({
      dexId: dex!.id,
      pairId: pair!.id,
      address: "0x0000000000000000000000000000000000dead",
      token0: tokenBySymbol.USDC!,
      token1: tokenBySymbol.WETH!,
    });

    await runSeed(db, null, { verify: false });

    const dexes = await db.select().from(schema.dexes);
    expect(dexes.length).toBe(2);
    const uniDex = dexes.find((d) => d.name === "uniswap-v2")!;
    expect(uniDex.factory).toBe(DEXES[0]!.factory);
    expect(uniDex.feeBps).toBe(30);

    const windows = await db.select().from(schema.windows);
    expect(windows.length).toBe(4);
    const krach = windows.find((w) => w.name === "2021-05 krach")!;
    expect(krach.fromTs.toISOString()).not.toBe("2000-01-01T00:00:00.000Z");

    const pools = await db.select().from(schema.pools);
    expect(pools.length).toBe(8);
    const wethUsdcPair2 = (await db.select().from(schema.pairs)).find((p) => p.symbol === "WETH/USDC")!;
    const uniWethUsdcPool = pools.find((p) => p.dexId === uniDex.id && p.pairId === wethUsdcPair2.id)!;
    expect(uniWethUsdcPool.address).toBe(POOLS[0]!.address);
    expect(uniWethUsdcPool.address).not.toBe("0x0000000000000000000000000000000000dead");
  });
});
