/**
 * Job `verify:pair-window`: dla każdej okazji (`opportunities`) w oknie
 * wybiera kandydata na atomowy arbitraż (`pickCandidate`), pobiera jego receipt
 * (`fetchReceipts`), klasyfikuje (`classify`) i zapisuje wynik do
 * `opportunity_verifications` (idempotentnie — ON CONFLICT (opportunity_id) DO UPDATE).
 *
 * `VerifyRepo` odseparowuje logikę joba od Drizzle/SQL (jak `AnalyzeProgress`/`analyzePairWindow`
 * w etapie 2) — testowalne fake repo bez bazy; `createDrizzleVerifyRepo` to jedyna
 * implementacja produkcyjna. `JobContext` (jobId/log/progress/signal, `progress` w ułamku
 * 0..1) to ten sam kontrakt co `analyze:pair-window` (patrz `@dex-arb/shared` jobs.ts).
 *
 * Batching: okazje przetwarzamy w paczkach po `BATCH` posortowanych wg bloku — jeden
 * `loadSwaps`/`loadSpreads` na paczkę (zamiast per okazja), jeden `fetchReceipts` na paczkę dla
 * zdeduplikowanych hashy kandydatów (ta sama tx bywa kandydatem dla kilku sąsiednich okazji) i
 * jeden zbiorczy `upsertVerifications` na paczkę.
 *
 * `spreadAt`/ceny: `block_states` ma wiersz dla KAŻDEGO bloku okna (carry-forward wypełniany w
 * etapie 2) — brak wpisu w załadowanej mapie oznacza więc blok poza zapytanym zakresem, nie
 * "brak zmiany od poprzedniego": stąd `spreadAt`/referencja cenowa to zwykłe odczyty z mapy
 * (bez szukania wstecz), z bezpiecznym fallbackiem (nigdy nie "decayed"/cena 0) dla brzegu
 * okna.
 *
 * `PriceRef`/`ethUsd`: poprzednia wersja ZAKŁADAŁA `quoteUsd=1`/`baseUsd=ethUsd=(price_a+price_b)/2`
 * dla KAŻDEJ pary, poprawne tylko gdy quote jest stablecoinem; dla pary kwotowanej w WETH (np.
 * WBTC/WETH) `price_a` jest w skali quote/base, NIE ETH/USD, więc wynik byłby błędny o rząd(y)
 * wielkości. Teraz reużywamy `makeQuoteUsd`/`makeEthUsd` (`../quoteUsd.js`) — te same funkcje,
 * których używa `analyzePairWindow`/`analyzeWindow`:
 *  - quote-stablecoin: `quoteUsd`=1, `ethUsd`=własna `price_a` bloku konsumpcji (WYMAGA, żeby
 *    token bazowy pary był WETH — inaczej `price_a` nie jest kursem ETH/USD; `makeEthUsd` rzuca,
 *    gdy to założenie nie zachodzi, propagowane bez przechwytywania przez `runVerifyPairWindow`);
 *  - quote=WETH: `quoteUsd`=`ethUsd`= kurs referencyjny z JUŻ PRZEANALIZOWANEJ pary WETH/USDC
 *    tego samego okna (`loadRefEthUsd`, reużyte z `analyzePairWindow.ts` przez `VerifyRepo`),
 *    `baseUsd` = własna `price_a` (quote/base) × ten kurs referencyjny.
 * Referencja ładowana raz na cały bieg joba (nie per okazja) — `quoteSymbol`/`baseSymbol`
 * pary nie zmieniają się między okazjami tego samego wywołania.
 */
import type { JobContext } from "@dex-arb/shared";
import { SPREAD_THRESHOLD_PCT } from "@dex-arb/shared";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { schema, type Db } from "@dex-arb/db";
import { loadRefEthUsd as loadRefEthUsdRow } from "../analyzePairWindow.js";
import { classify, pickCandidate, K_MAX } from "./classify.js";
import type { ClassifyInput, OpportunityInput } from "./classify.js";
import type { DetectContext } from "./detect.js";
import { PAIR_CONVENTION } from "../reserveStates.js";
import { makeEthUsd, makeQuoteUsd } from "../quoteUsd.js";
import { fetchReceipts } from "./receipt.js";
import type { RpcLike } from "./receipt.js";
import type { Route } from "./route.js";
import type { Receipt, SwapRow, VerificationResult, VerificationStatus } from "./types.js";

export interface SpreadRow {
  spreadPct: number;
  priceA: number;
  priceB: number;
}

export interface VerifyRepo {
  /** `baseSymbol`/`quoteSymbol` — symbole tokenów pary, potrzebne
   * do wyboru `makeQuoteUsd`/`makeEthUsd` (patrz komentarz modułu). */
  loadPairContext(pairId: number): Promise<{ ctx: DetectContext; baseSymbol: string; quoteSymbol: string }>;
  listOpportunities(pairId: number, windowId: number, skipVerified: boolean): Promise<OpportunityInput[]>;
  loadSwaps(poolIds: number[], fromBlock: number, toBlock: number): Promise<SwapRow[]>;
  loadSpreads(pairId: number, fromBlock: number, toBlock: number): Promise<Map<number, SpreadRow>>;
  /** Kurs ETH/USD referencyjnej pary WETH/USDC TEGO SAMEGO okna — wołane TYLKO gdy analizowana
   * para jest kwotowana w WETH (patrz komentarz modułu); reużywa `loadRefEthUsd` z
   * `analyzePairWindow.ts` (rzuca polski błąd, gdy referencja nie została jeszcze przeanalizowana). */
  loadRefEthUsd(windowId: number): Promise<(block: number) => number>;
  /** Zapisuje wyniki paczki (≤ `BATCH`) jednym zbiorczym upsertem. */
  upsertVerifications(results: VerificationResult[]): Promise<void>;
}

export interface VerifyParams {
  pairId: number;
  windowId: number;
  force?: boolean;
}

export interface VerifyDeps {
  repo: VerifyRepo;
  rpc: RpcLike;
  ctx: JobContext;
  /** Współbieżność pobierania receiptów — domyślnie `RPC_CONCURRENCY` (env), inaczej 4. */
  concurrency?: number;
  thresholdPct?: number;
}

export interface VerifySummary {
  total: number;
  byStatus: Record<VerificationStatus, number>;
  /** Liczności trasy (`classifyRoute`, route.ts) WŚRÓD `consumed_atomic` — sumuje się do
   * `byStatus.consumed_atomic`. */
  byRoute: Record<Route, number>;
}

/** Ile okazji przetwarzamy w jednej paczce (jeden `loadSwaps`/`loadSpreads`/`upsertVerifications`). */
const BATCH = 200;

function checkAbort(ctx: JobContext): void {
  if (ctx.signal.aborted) throw new Error("Przerwano");
}

export async function runVerifyPairWindow(params: VerifyParams, deps: VerifyDeps): Promise<VerifySummary> {
  const { repo, rpc, ctx } = deps;
  const concurrency = deps.concurrency ?? Number(process.env.RPC_CONCURRENCY ?? 4);
  const thresholdPct = deps.thresholdPct ?? SPREAD_THRESHOLD_PCT;

  const { ctx: detectCtx, baseSymbol, quoteSymbol } = await repo.loadPairContext(params.pairId);
  const poolIds = detectCtx.pools.map((p) => p.id);

  // `makeQuoteUsd`/`makeEthUsd` (`../quoteUsd.js`, patrz komentarz modułu) same rzucają: dla
  // tokena kwotowanego spoza {USDC,USDT,DAI,WETH}, oraz (`makeEthUsd`, ta sama zasada co w
  // `analyzePairWindow.ts`) gdy para jest kwotowana w stablecoinie, ale
  // token BAZOWY nie jest WETH (wtedy własna `price_a` nie jest kursem ETH/USD).
  const refEthUsd = quoteSymbol === "WETH" ? await repo.loadRefEthUsd(params.windowId) : undefined;
  const quoteUsdAt = makeQuoteUsd(quoteSymbol, refEthUsd);
  const ethUsdAt = makeEthUsd(quoteSymbol, baseSymbol, refEthUsd);

  const opps = (await repo.listOpportunities(params.pairId, params.windowId, !params.force)).sort((a, b) => a.block - b.block);
  const byStatus: Record<VerificationStatus, number> = { consumed_atomic: 0, consumed_partial: 0, decayed: 0, persisted: 0 };
  const byRoute: Record<Route, number> = { two_pool: 0, multi: 0 };
  await ctx.log(`weryfikacja: ${opps.length} okazji do sprawdzenia (para ${params.pairId}, okno ${params.windowId})`);

  for (let i = 0; i < opps.length; i += BATCH) {
    checkAbort(ctx);
    const batch = opps.slice(i, i + BATCH);
    const fromBlock = batch[0]!.block;
    const toBlock = batch[batch.length - 1]!.block + K_MAX;

    const [swaps, spreads] = await Promise.all([
      repo.loadSwaps(poolIds, fromBlock, toBlock),
      repo.loadSpreads(params.pairId, fromBlock, toBlock),
    ]);

    const inputs: ClassifyInput[] = batch.map((opp) => ({
      opp,
      swaps: swaps.filter((s) => s.block >= opp.block && s.block <= opp.block + K_MAX),
      // brak wpisu = poza zapytanym zakresem (patrz komentarz modułu) -> traktujemy jak
      // "spread nieznany, nigdy nie spadł poniżej progu", żeby nie fałszować decay/consumed_partial.
      spreadAt: (b) => spreads.get(b)?.spreadPct ?? Number.POSITIVE_INFINITY,
      thresholdPct,
      ctx: detectCtx,
    }));
    const candidates = inputs.map(pickCandidate);

    const hashes = [...new Set(candidates.flatMap((c) => (c ? [c.txHash] : [])))];
    const receipts = hashes.length > 0 ? await fetchReceipts(rpc, hashes, concurrency) : new Map<string, Receipt>();

    const results: VerificationResult[] = inputs.map((input, j) => {
      const cand = candidates[j]!;
      const receipt = cand ? (receipts.get(cand.txHash) ?? null) : null;
      const refBlock = cand ? cand.block : input.opp.block;
      const ref = spreads.get(refBlock);
      const priceA = ref?.priceA ?? 0;
      // `quoteUsdAt`/`ethUsdAt` (patrz komentarz modułu): drugi argument `state: PairBlockState`
      // z sygnatury `QuoteUsdFn` jest ignorowany przez OBIE gałęzie `makeQuoteUsd` (stablecoin ->
      // stała 1; WETH -> tylko `block`) — `verify:pair-window` nie ma pełnego `PairBlockState`
      // (buduje go `analyzeWindow.ts` z syncs/rezerw, tutaj mamy tylko `SpreadRow` z
      // `block_states`), stąd `as never` zamiast konstruowania nieużywanego obiektu.
      const quoteUsd = quoteUsdAt(refBlock, undefined as never);
      const ethUsd = ethUsdAt(refBlock, priceA);
      const baseUsd = priceA * quoteUsd;
      return classify(input, cand, receipt, { baseUsd, quoteUsd }, ethUsd);
    });
    for (const r of results) byStatus[r.status]++;

    // `beneficiary`/`beneficiaryKind` nie mają kolumny w `opportunity_verifications` — pola
    // diagnostyczne, celowo bez migracji: trzymane w `VerificationResult` i logowane zamiast
    // persystowane. `upsertVerifications` poniżej celowo pomija te dwa pola.
    const kindCounts = results.reduce<Partial<Record<string, number>>>((acc, r) => {
      if (r.beneficiaryKind) acc[r.beneficiaryKind] = (acc[r.beneficiaryKind] ?? 0) + 1;
      return acc;
    }, {});
    if (Object.keys(kindCounts).length > 0) {
      await ctx.log(`beneficiary_kind (nie persystowane, brak kolumny): ${JSON.stringify(kindCounts)}`);
    }

    // `route` (route.ts) jest persystowane w kolumnie `opportunity_verifications.route`
    // (migracja 0005); tu tylko liczności per paczka do logu i do `VerifySummary.byRoute`.
    const batchRoute: Record<Route, number> = { two_pool: 0, multi: 0 };
    for (const r of results) if (r.route) batchRoute[r.route]++;
    if (batchRoute.two_pool + batchRoute.multi > 0) {
      byRoute.two_pool += batchRoute.two_pool;
      byRoute.multi += batchRoute.multi;
      await ctx.log(`route: ${JSON.stringify(batchRoute)}`);
    }

    await repo.upsertVerifications(results);
    await ctx.progress(Math.min(1, (i + batch.length) / Math.max(opps.length, 1)));
  }

  await ctx.progress(1);
  await ctx.log(`weryfikacja zakończona: ${JSON.stringify(byStatus)}, route: ${JSON.stringify(byRoute)}`);
  return { total: opps.length, byStatus, byRoute };
}

// ---------------------------------------------------------------------------------------
// Implementacja Drizzle
// ---------------------------------------------------------------------------------------

/** Batch upsertu opportunity_verifications — spójne z konwencją innych writerów (`db.ts`, BATCH=1000). */
const UPSERT_BATCH = 1000;

export function createDrizzleVerifyRepo(db: Db): VerifyRepo {
  const { pools, pairs, tokens, dexes, opportunities, opportunityVerifications, swapEvents, blockStates } = schema;

  async function loadPools(pairId: number): Promise<{ poolA: { id: number; address: string; token0: string; token1: string; dexName: string }; poolB: { id: number; address: string; token0: string; token1: string; dexName: string } }> {
    const rows = await db
      .select({ id: pools.id, address: pools.address, token0: pools.token0, token1: pools.token1, dexName: dexes.name })
      .from(pools)
      .innerJoin(dexes, eq(pools.dexId, dexes.id))
      .where(eq(pools.pairId, pairId));
    const poolA = rows.find((p) => p.dexName.toLowerCase() === PAIR_CONVENTION.a);
    const poolB = rows.find((p) => p.dexName.toLowerCase() === PAIR_CONVENTION.b);
    if (!poolA || !poolB) throw new Error(`para ${pairId}: potrzebne są pule zarówno na Uniswap V2, jak i na Sushiswap`);
    return { poolA, poolB };
  }

  return {
    async loadPairContext(pairId) {
      const [pair] = await db.select().from(pairs).where(eq(pairs.id, pairId));
      if (!pair) throw new Error(`para ${pairId} nie istnieje`);
      const [tb] = await db.select().from(tokens).where(eq(tokens.address, pair.tokenBase));
      const [tq] = await db.select().from(tokens).where(eq(tokens.address, pair.tokenQuote));
      if (!tb || !tq) throw new Error(`para ${pairId}: brak tokena bazowego lub kwotowanego w tabeli tokens`);
      const { poolA, poolB } = await loadPools(pairId);
      return {
        ctx: {
          pools: [poolA, poolB],
          pair: { id: pair.id, tokenBase: pair.tokenBase, tokenQuote: pair.tokenQuote, baseDecimals: tb.decimals, quoteDecimals: tq.decimals },
        },
        baseSymbol: tb.symbol,
        quoteSymbol: tq.symbol,
      };
    },

    // Reużywa `loadRefEthUsd` z `analyzePairWindow.ts` (patrz
    // komentarz modułu) zamiast duplikować zapytanie o `block_states` pary referencyjnej.
    async loadRefEthUsd(windowId) {
      return loadRefEthUsdRow(db, windowId);
    },

    async listOpportunities(pairId, windowId, skipVerified) {
      const { poolA, poolB } = await loadPools(pairId);
      const rows = await db
        .select({
          id: opportunities.id,
          block: opportunities.block,
          spreadPct: opportunities.spreadPct,
          direction: opportunities.direction,
          verified: opportunityVerifications.opportunityId,
        })
        .from(opportunities)
        .leftJoin(opportunityVerifications, eq(opportunityVerifications.opportunityId, opportunities.id))
        .where(and(eq(opportunities.pairId, pairId), eq(opportunities.windowId, windowId)));
      // direction "a_to_b": kup w A (tańsza), sprzedaj w B (droższa) -> B droższa; "b_to_a" odwrotnie
      // (patrz packages/core/src/amm.ts `arbitrage()` i packages/analysis/src/opportunities.ts).
      return rows
        .filter((r) => !skipVerified || r.verified === null)
        .map((r) => ({ id: r.id, block: r.block, spreadPct: r.spreadPct, expensivePoolId: r.direction === "a_to_b" ? poolB.id : poolA.id }));
    },

    async loadSwaps(poolIds, fromBlock, toBlock) {
      const rows = await db
        .select()
        .from(swapEvents)
        .where(and(inArray(swapEvents.poolId, poolIds), gte(swapEvents.block, fromBlock), lte(swapEvents.block, toBlock)));
      // amount*/gasPrice bywają NULL tylko dla wierszy z zaniechanego importu CSV (docs/konwencje.md:
      // logIndex uszkodzony przez przepełnienie uint32) — okna analizowane przez ten etap
      // pochodzą z RPC ingestu (zawsze pełne); 0n to bezpieczny fallback, nie milcząca poprawność.
      return rows.map((r) => ({
        poolId: r.poolId,
        block: r.block,
        logIndex: r.logIndex,
        txHash: r.txHash,
        sender: r.sender ?? "",
        to: r.to ?? "",
        amount0In: r.amount0In == null ? 0n : BigInt(r.amount0In),
        amount0Out: r.amount0Out == null ? 0n : BigInt(r.amount0Out),
        amount1In: r.amount1In == null ? 0n : BigInt(r.amount1In),
        amount1Out: r.amount1Out == null ? 0n : BigInt(r.amount1Out),
        gasPrice: r.gasPrice == null ? null : BigInt(r.gasPrice),
      }));
    },

    async loadSpreads(pairId, fromBlock, toBlock) {
      const rows = await db
        .select({ block: blockStates.block, spreadPct: blockStates.spreadPct, priceA: blockStates.priceA, priceB: blockStates.priceB })
        .from(blockStates)
        .where(and(eq(blockStates.pairId, pairId), gte(blockStates.block, fromBlock), lte(blockStates.block, toBlock)));
      return new Map(rows.map((r) => [r.block, { spreadPct: r.spreadPct, priceA: r.priceA, priceB: r.priceB }]));
    },

    async upsertVerifications(results) {
      for (let i = 0; i < results.length; i += UPSERT_BATCH) {
        const chunk = results.slice(i, i + UPSERT_BATCH).map((r) => ({
          opportunityId: r.opportunityId,
          status: r.status,
          consumerTxHash: r.consumerTxHash,
          realizedProfitUsd: r.realizedProfitUsd,
          gasUsed: r.gasUsed == null ? null : r.gasUsed.toString(),
          gasCostUsd: r.gasCostUsd,
          blocksToConsumption: r.blocksToConsumption,
          profitableConsumed: r.profitableConsumed,
          // `route` (migracja 0005) — `null` dla statusów innych niż consumed_atomic (`classify`
          // ustawia je tylko w gałęzi consumed_atomic; CHECK w bazie to wymusza).
          route: r.status === "consumed_atomic" ? r.route : null,
          verifiedAt: new Date(),
        }));
        if (chunk.length === 0) continue;
        await db
          .insert(opportunityVerifications)
          .values(chunk)
          .onConflictDoUpdate({
            target: opportunityVerifications.opportunityId,
            set: {
              status: sql`excluded.status`,
              consumerTxHash: sql`excluded.consumer_tx_hash`,
              realizedProfitUsd: sql`excluded.realized_profit_usd`,
              gasUsed: sql`excluded.gas_used`,
              gasCostUsd: sql`excluded.gas_cost_usd`,
              blocksToConsumption: sql`excluded.blocks_to_consumption`,
              profitableConsumed: sql`excluded.profitable_consumed`,
              route: sql`excluded.route`,
              verifiedAt: sql`excluded.verified_at`,
            },
          });
      }
    },
  };
}
