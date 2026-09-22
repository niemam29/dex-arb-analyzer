// Logika seeda konfiguracji: DEX-y, tokeny, pary, pule, okna analizy. JEDYNY seed
// w monorepo (root `db:seed` woła ten skrypt).
// Wydzielona z packages/ingest/scripts/seed.ts, żeby dało się ją testować na realnym Postgresie
// z zamockowanym RPC (bez procesu CLI, bez process.exit).
import { schema, type Db } from "@dex-arb/db";
import { and, eq, sql } from "drizzle-orm";
import type { RpcRequest } from "./rpc/client.js";
import { resolveWindowBlocks } from "./blocks/find-block.js";
import { DEXES, TOKENS, PAIRS, POOLS, WINDOWS, getPairCalldata, decodeAddress, PAIR_ERC20_IFACE } from "./seed-data.js";

/** Minimalny interfejs RPC wymagany przez seed (ten sam kształt co RpcLike w logs/fetch-logs.ts) — łatwy do zamockowania w testach. */
export interface RpcLike {
  call<T>(method: string, params: unknown[]): Promise<T>;
  batch<T>(reqs: RpcRequest[]): Promise<T[]>;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface SeedPoolResult {
  dex: string;
  pair: string;
  address: string;
  token0: string;
  token1: string;
  /** "OK" = adres z SEED potwierdzony on-chain, "NEW" = potwierdzony po raz pierwszy (--verify),
   *  "unverified" = wzięty z SEED bez sprawdzenia on-chain (uruchomienie bez --verify). */
  status: "OK" | "NEW" | "unverified";
  /** true = wiersz właśnie wstawiony do pools; false = już istniał — ponownie uruchomiony seed go
   *  AKTUALIZUJE w miejscu (ON CONFLICT DO UPDATE po (dex_id,pair_id)), nie zostawia nieświeżych
   *  wartości i nie tworzy duplikatu. */
  inserted: boolean;
}

/**
 * Seeduje dexes/tokens/pairs/windows/pools — idempotentnie i BEZ pozostawiania nieświeżych
 * wartości: ON CONFLICT DO UPDATE po naturalnym kluczu (dexes.name, tokens.address, pairs.symbol,
 * windows.name, pools(dex_id,pair_id)), nie DO NOTHING. Dla każdej pozycji POOLS łączy dex i parę
 * PO SYMBOLU (nigdy "pierwszy wiersz"). Gdy podano rpc, adres puli i token0/token1 są potwierdzane
 * przez factory.getPair()/token0()/token1(); niezgodność adresu z SEED rzuca błąd (komunikat po
 * polsku) — wywołujący (CLI) łapie go i kończy kodem 1. Wszystkie adresy zapisywane małymi
 * literami (konwencja repo, docs/konwencje.md „Decyzje" — char(42) porównywany case-sensitive w Postgresie,
 * więc niespójna wielkość liter tworzyłaby duplikaty).
 */
export async function runSeed(db: Db, rpc: RpcLike | null, opts: { verify: boolean }): Promise<SeedPoolResult[]> {
  if (opts.verify && !rpc) throw new Error("runSeed: verify=true wymaga przekazania klienta RPC");

  // Cały seed (dexes/tokens/pairs/windows/pools) w JEDNEJ transakcji (fix z rundy poprawek 2):
  // gdy weryfikacja on-chain (--verify) nie zgadza się w połowie pętli po POOLS, transakcja się
  // wycofuje i baza zostaje nietknięta — bez tego wcześniejsze wiersze (dexy/tokeny/pary/okna,
  // pule sprzed niezgodnej) zostałyby zapisane mimo błędu całego seeda. Wywołania RPC (weryfikacja)
  // mogą się wykonywać wewnątrz transakcji — nie dotykają bazy, więc nie wydłużają jej blokad ponad
  // czas samego eth_call.
  return db.transaction(async (tx) => {
    await tx
      .insert(schema.dexes)
      .values(DEXES.map((d) => ({ ...d })))
      .onConflictDoUpdate({
        target: schema.dexes.name,
        set: { factory: sql`excluded.factory`, feeBps: sql`excluded.fee_bps` },
      });

    await tx
      .insert(schema.tokens)
      .values(TOKENS.map((t) => ({ ...t })))
      .onConflictDoUpdate({
        target: schema.tokens.address,
        set: { symbol: sql`excluded.symbol`, decimals: sql`excluded.decimals` },
      });

    const tokenBySymbol = Object.fromEntries(TOKENS.map((t) => [t.symbol, t.address]));
    await tx
      .insert(schema.pairs)
      .values(PAIRS.map((p) => ({ symbol: p.symbol, tokenBase: tokenBySymbol[p.base]!, tokenQuote: tokenBySymbol[p.quote]! })))
      .onConflictDoUpdate({
        target: schema.pairs.symbol,
        set: { tokenBase: sql`excluded.token_base`, tokenQuote: sql`excluded.token_quote` },
      });

    await tx
      .insert(schema.windows)
      .values(WINDOWS.map((w) => ({ name: w.name, fromTs: new Date(w.fromTs * 1000), toTs: new Date(w.toTs * 1000), fromBlock: w.fromBlock, toBlock: w.toBlock })))
      .onConflictDoUpdate({
        target: schema.windows.name,
        set: {
          fromTs: sql`excluded.from_ts`,
          toTs: sql`excluded.to_ts`,
          // Daty bez zmian: zachowaj bloki już wyznaczone przez ingest (jeśli są), inaczej oczekiwane z seed-data.
          // Daty zmienione: bloki z seed-data są nieaktualne -> NULL (ingest wyznaczy przez RPC).
          fromBlock: sql`CASE WHEN windows.from_ts = excluded.from_ts AND windows.to_ts = excluded.to_ts THEN coalesce(windows.from_block, excluded.from_block) ELSE NULL END`,
          toBlock: sql`CASE WHEN windows.from_ts = excluded.from_ts AND windows.to_ts = excluded.to_ts THEN coalesce(windows.to_block, excluded.to_block) ELSE NULL END`,
        },
      });

    const dexes = await tx.select().from(schema.dexes);
    const pairs = await tx.select().from(schema.pairs);

    const results: SeedPoolResult[] = [];
    for (const p of POOLS) {
      // Łączymy PO SYMBOLU/NAZWIE — nigdy przez "pierwszy wiersz" (dexes/pairs mogą zawierać wiersze
      // z innych seedów uruchomionych wcześniej na tej samej bazie).
      const dex = dexes.find((d) => d.name === p.dex);
      if (!dex) throw new Error(`Seed: brak DEX-u "${p.dex}" w bazie (sprawdź DEXES w seed-data.ts)`);
      const pair = pairs.find((x) => x.symbol === p.pair);
      if (!pair) throw new Error(`Seed: brak pary "${p.pair}" w bazie (sprawdź PAIRS w seed-data.ts)`);

      let address = p.address;
      let status: SeedPoolResult["status"] = p.verified ? "OK" : "unverified";
      if (rpc) {
        // adres z factory.getPair — źródło prawdy on-chain
        const word = await rpc.call<string>("eth_call", [
          { to: dex.factory, data: getPairCalldata(pair.tokenBase, pair.tokenQuote) },
          "latest",
        ]);
        const onChain = decodeAddress(word);
        if (onChain === ZERO_ADDRESS) throw new Error(`${p.dex} ${p.pair}: factory nie zna pary (getPair zwrócił adres zerowy)`);
        if (address && onChain.toLowerCase() !== address.toLowerCase()) {
          throw new Error(`${p.dex} ${p.pair}: adres w seed ${address} ≠ on-chain ${onChain}`);
        }
        status = p.verified ? "OK" : "NEW";
        address = onChain.toLowerCase();
      } else if (!address) {
        throw new Error(`${p.dex} ${p.pair}: brak adresu — uruchom z --verify`);
      }
      const poolAddress: string = address;

      let token0: string;
      let token1: string;
      if (rpc) {
        const [w0, w1] = await rpc.batch<string>([
          { method: "eth_call", params: [{ to: poolAddress, data: PAIR_ERC20_IFACE.encodeFunctionData("token0") }, "latest"] },
          { method: "eth_call", params: [{ to: poolAddress, data: PAIR_ERC20_IFACE.encodeFunctionData("token1") }, "latest"] },
        ]);
        token0 = decodeAddress(w0!).toLowerCase();
        token1 = decodeAddress(w1!).toLowerCase();
      } else {
        // Bez RPC: Uniswap V2 sortuje token0 < token1 wg wartości adresu (tokenBase/tokenQuote z bazy
        // są już małymi literami — patrz insert tokens powyżej).
        [token0, token1] = [pair.tokenBase, pair.tokenQuote].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)) as [
          string,
          string,
        ];
      }

      const existing = await tx
        .select()
        .from(schema.pools)
        .where(and(eq(schema.pools.dexId, dex.id), eq(schema.pools.pairId, pair.id)));
      const inserted = existing.length === 0;

      await tx
        .insert(schema.pools)
        .values({ dexId: dex.id, pairId: pair.id, address: poolAddress, token0, token1 })
        .onConflictDoUpdate({
          target: [schema.pools.dexId, schema.pools.pairId],
          set: { address: sql`excluded.address`, token0: sql`excluded.token0`, token1: sql`excluded.token1` },
        });

      results.push({ dex: p.dex, pair: p.pair, address: poolAddress, token0, token1, status, inserted });
    }

    // --verify: ponownie wyznacz bloki okien z RPC i ostrzeż, gdy różnią się od utrwalonych
    // w seed-data.ts (np. RPC zmienił zdanie o timestampie bloku, albo dane w seed-data.ts się
    // zdezaktualizowały) — nie blokuje seeda, tylko sygnalizuje rozbieżność do zbadania.
    if (rpc) {
      for (const w of WINDOWS) {
        await resolveWindowBlocks(rpc, w.fromTs, w.toTs, {
          expected: { fromBlock: w.fromBlock, toBlock: w.toBlock },
          warn: (msg) => console.warn(`[seed --verify] ${msg}`),
        });
      }
    }

    return results;
  });
}
