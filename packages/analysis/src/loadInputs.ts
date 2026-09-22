// Wczytanie wejść do analizy pary w oknie z bazy. A = pula na Uniswap V2,
// B = pula na Sushiswap (rozstrzygnięcie po nazwie DEX-u — konwencja `PAIR_CONVENTION`
// w reserveStates.ts). `window.from_block/to_block` czytane z bazy tak, jak wypełnił je
// ingest (nigdy nie przeliczane tutaj); brak wypełnienia = okno niezingestowane.
import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { schema, type Db } from "@dex-arb/db";
import { PAIR_CONVENTION, type PoolSpec, type SyncRow } from "./reserveStates.js";

export interface PairWindowInputs {
  pair: {
    id: number;
    symbol: string;
    /** adresy tokenów (małe litery) — do orientacji pul przez `orientPool`. */
    tokenBase: string;
    tokenQuote: string;
    decBase: number;
    decQuote: number;
    baseSymbol: string;
    quoteSymbol: string;
  };
  window: { id: number; fromBlock: number; toBlock: number };
  poolA: PoolSpec & { feeBps: number };
  poolB: PoolSpec & { feeBps: number };
  /** posortowane rosnąco po (block, log_index), obie pule */
  syncs: SyncRow[];
  /** liczba Swapów w bloku, obie pule razem */
  swapsPerBlock: Map<number, number>;
  /** mediana ceny gazu bloku [gwei], rosnąco po block, tylko bloki z wypełnionym gas_price_median */
  gasSamples: { block: number; gwei: number }[];
}

export async function loadPairWindowInputs(db: Db, pairId: number, windowId: number): Promise<PairWindowInputs> {
  const [pair] = await db.select().from(schema.pairs).where(eq(schema.pairs.id, pairId));
  const [win] = await db.select().from(schema.windows).where(eq(schema.windows.id, windowId));
  if (!pair) throw new Error(`Brak pary o id ${pairId}`);
  if (!win) throw new Error(`Brak okna o id ${windowId}`);
  if (win.fromBlock === null || win.toBlock === null) {
    throw new Error(`Okno „${win.name}" (id ${windowId}) nie ma wypełnionych from_block/to_block — nie zostało zingestowane`);
  }
  const fromBlock = win.fromBlock;
  const toBlock = win.toBlock;

  const [tokBase] = await db.select().from(schema.tokens).where(eq(schema.tokens.address, pair.tokenBase));
  const [tokQuote] = await db.select().from(schema.tokens).where(eq(schema.tokens.address, pair.tokenQuote));
  if (!tokBase || !tokQuote) throw new Error(`Para „${pair.symbol}": brak tokena bazowego lub kwotowanego w tabeli tokens`);

  const poolRows = await db
    .select({
      id: schema.pools.id,
      token0: schema.pools.token0,
      token1: schema.pools.token1,
      dexName: schema.dexes.name,
      feeBps: schema.dexes.feeBps,
    })
    .from(schema.pools)
    .innerJoin(schema.dexes, eq(schema.pools.dexId, schema.dexes.id))
    .where(eq(schema.pools.pairId, pairId));
  const uni = poolRows.find((p) => p.dexName.toLowerCase() === PAIR_CONVENTION.a);
  const sushi = poolRows.find((p) => p.dexName.toLowerCase() === PAIR_CONVENTION.b);
  if (!uni || !sushi) {
    throw new Error(`Para „${pair.symbol}": potrzebne są pule zarówno na Uniswap V2, jak i na Sushiswap`);
  }
  // Orientacja (który token jest base/token0) liczona przez `orientPool` w `reserveStates.ts` —
  // tutaj przekazujemy tylko surowe adresy token0/token1 puli, bez zakładania z góry ich układu.
  const spec = (p: typeof uni): PoolSpec & { feeBps: number } => ({
    poolId: p.id,
    token0: p.token0,
    token1: p.token1,
    feeBps: p.feeBps,
  });

  const poolIds = [uni.id, sushi.id];

  const syncRows = await db
    .select({
      poolId: schema.syncEvents.poolId,
      block: schema.syncEvents.block,
      logIndex: schema.syncEvents.logIndex,
      reserve0: schema.syncEvents.reserve0,
      reserve1: schema.syncEvents.reserve1,
    })
    .from(schema.syncEvents)
    .where(and(inArray(schema.syncEvents.poolId, poolIds), gte(schema.syncEvents.block, fromBlock), lte(schema.syncEvents.block, toBlock)))
    .orderBy(asc(schema.syncEvents.block), asc(schema.syncEvents.logIndex));
  const syncs: SyncRow[] = syncRows.map((r) => ({ ...r, reserve0: BigInt(r.reserve0), reserve1: BigInt(r.reserve1) }));

  const swapCounts = await db
    .select({ block: schema.swapEvents.block, n: sql<number>`count(*)::int` })
    .from(schema.swapEvents)
    .where(and(inArray(schema.swapEvents.poolId, poolIds), gte(schema.swapEvents.block, fromBlock), lte(schema.swapEvents.block, toBlock)))
    .groupBy(schema.swapEvents.block);
  const swapsPerBlock = new Map(swapCounts.map((r) => [r.block, r.n]));

  // Wymóg reprodukowalności: próbki gazu do interpolacji = TYLKO bloki, w których
  // wystąpiło zdarzenie (Sync lub Swap) którejś z DWÓCH pul TEJ pary — deterministyczne per
  // para. Bez tego ograniczenia `blocks` (tabela współdzielona przez wszystkie pary) wciągałby
  // do interpolacji gazu bloki należące wyłącznie do zdarzeń zupełnie innych par w tym samym
  // oknie, co czyniłoby wynik zależnym od tego, jakie inne pary akurat zostały zingestowane.
  const pairEventBlocks = new Set<number>([...syncs.map((s) => s.block), ...swapsPerBlock.keys()]);

  const gasRows = await db
    .select({ block: schema.blocks.number, wei: schema.blocks.gasPriceMedian })
    .from(schema.blocks)
    .where(and(gte(schema.blocks.number, fromBlock), lte(schema.blocks.number, toBlock), isNotNull(schema.blocks.gasPriceMedian)))
    .orderBy(asc(schema.blocks.number));
  // gas_price_median jest w wei (numeric) -> gwei
  const gasSamples = gasRows
    .filter((r) => pairEventBlocks.has(r.block))
    .map((r) => ({ block: r.block, gwei: Number(r.wei) / 1e9 }));

  return {
    pair: {
      id: pair.id,
      symbol: pair.symbol,
      tokenBase: pair.tokenBase,
      tokenQuote: pair.tokenQuote,
      decBase: tokBase.decimals,
      decQuote: tokQuote.decimals,
      baseSymbol: tokBase.symbol,
      quoteSymbol: tokQuote.symbol,
    },
    window: { id: win.id, fromBlock, toBlock },
    poolA: spec(uni),
    poolB: spec(sushi),
    syncs,
    swapsPerBlock,
    gasSamples,
  };
}
