/**
 * Jedna próbka panelu na żywo (spec §3): stan 8 pul w jednym bloku + aktywność swapów z ostatnich
 * LIVE_SWAP_LOOKBACK_BLOCKS bloków, przeliczona na spread/kierunek/zysk/TVL per para DOKŁADNIE tą
 * samą arytmetyką co `computeBlockStates` (analyzeWindow.ts): `orientPool`/`quotePerBase`,
 * `arbitrage`, `baselineNetProfitUsd` (netto = 0 bez kierunku), `makeQuoteUsd`/`makeEthUsd`.
 * Cechy S/G/L/M liczy dopiero `score.ts` (potrzebuje historii z bufora do percentyli M).
 *
 * Dwa batche JSON-RPC (nie jeden): tag bloku dla eth_call pochodzi z odpowiedzi
 * eth_getBlockByNumber, więc rezerwy i logi mogą polecieć dopiero w drugim pakiecie.
 */
import { arbitrage, baselineNetProfitUsd, spreadPct } from "@dex-arb/core";
import { LIVE_PRIORITY_GWEI, LIVE_SWAP_LOOKBACK_BLOCKS, REFERENCE_PAIR_SYMBOL, type DirectionKind } from "@dex-arb/shared";
import { makeEthUsd, makeQuoteUsd } from "../quoteUsd.js";
import { poolStateFromReserves, type PairBlockState, type PoolState } from "../reserveStates.js";
import {
  GET_RESERVES_SELECTOR, TOPIC_SWAP_V2, decodeReserves, hexToNumber, isArchiveError, toHexBlock,
  type LiveRpc, type LiveRpcRequest, type RawLiveBlock, type RawLiveLog,
} from "./rpcTypes.js";

export interface LivePool {
  address: string;
  token0: string;
  token1: string;
  dexName: string;
  feeBps: number;
}

/** Para z katalogu (pairs/pools/tokens/dexes) — A = Uniswap V2, B = Sushiswap (PAIR_CONVENTION). */
export interface LivePair {
  id: number;
  symbol: string;
  tokenBase: string;
  tokenQuote: string;
  decBase: number;
  decQuote: number;
  baseSymbol: string;
  quoteSymbol: string;
  poolA: LivePool;
  poolB: LivePool;
}

export interface LivePoolSample {
  dexName: string;
  price: number;
  reserveBase: bigint;
  reserveQuote: bigint;
  /** 2× strona quote w jednostkach quote (jak `PoolState.tvlQuote`) */
  tvlQuote: number;
}

export interface LivePairSample {
  pairId: number;
  symbol: string;
  poolA: LivePoolSample;
  poolB: LivePoolSample;
  spreadPct: number;
  direction: DirectionKind;
  optTradeUsd: number;
  grossProfitUsd: number;
  /** netto v1 (220k · gwei · ETHUSD); 0 gdy brak kierunku — jak `baselineNetProfitUsd` w block_states */
  netProfitUsd: number;
  tvlMinUsd: number;
  /** kurs ETH/USD użyty do kosztu gazu tej pary (`makeEthUsd`) */
  ethUsd: number;
  /** średnia liczba Swapów obu pul na blok w oknie LIVE_SWAP_LOOKBACK_BLOCKS */
  swapsPerBlock: number;
}

export interface LiveSample {
  /** ISO czasu pobrania próbki (zegar procesu, nie bloku) */
  at: string;
  block: number;
  blockTimestamp: number;
  baseFeeGwei: number;
  /** baseFee + LIVE_PRIORITY_GWEI */
  gasGwei: number;
  /** kurs ETH/USD z pary referencyjnej (pula A) */
  ethUsd: number;
  /** false, gdy rezerwy pobrano z tagiem `latest` (fallback, spec §10) */
  consistent: boolean;
  pairs: LivePairSample[];
}

export interface SampleContext {
  now?: () => Date;
  log?: (msg: string) => void;
}

const DIRECTION: Record<"a->b" | "b->a" | "none", DirectionKind> = { "a->b": "a_to_b", "b->a": "b_to_a", none: "none" };

function toPoolState(pool: LivePool, pair: LivePair, r: { reserve0: bigint; reserve1: bigint }): PoolState {
  return poolStateFromReserves(r.reserve0, r.reserve1, pool, pair);
}

function reserveRequests(pools: LivePool[], tag: string): LiveRpcRequest[] {
  return pools.map((p) => ({ method: "eth_call", params: [{ to: p.address, data: GET_RESERVES_SELECTOR }, tag] }));
}

export async function sampleLive(rpc: LiveRpc, pairs: LivePair[], ctx: SampleContext = {}): Promise<LiveSample> {
  const now = ctx.now ?? (() => new Date());
  const log = ctx.log ?? (() => {});

  const [blk] = await rpc.batch<RawLiveBlock>([{ method: "eth_getBlockByNumber", params: ["latest", false] }]);
  if (!blk) throw new Error("eth_getBlockByNumber: pusta odpowiedź");
  const block = hexToNumber(blk.number);
  const tag = toHexBlock(block);
  const fromBlock = toHexBlock(Math.max(0, block - (LIVE_SWAP_LOOKBACK_BLOCKS - 1)));
  const baseFeeGwei = blk.baseFeePerGas ? Number(BigInt(blk.baseFeePerGas)) / 1e9 : 0;
  const gasGwei = baseFeeGwei + LIVE_PRIORITY_GWEI;

  const pools = pairs.flatMap((p) => [p.poolA, p.poolB]);
  const logsReq: LiveRpcRequest = {
    method: "eth_getLogs",
    params: [{ address: pools.map((p) => p.address), topics: [TOPIC_SWAP_V2], fromBlock, toBlock: tag }],
  };

  let results: unknown[];
  let consistent = true;
  try {
    results = await rpc.batch<unknown>([...reserveRequests(pools, tag), logsReq]);
  } catch (e) {
    // Fallback na `latest` ma sens TYLKO dla braku archiwum (eRPC bez trybu archive odrzuca
    // eth_call z konkretnym numerem bloku) — inne błędy (sieć, zły parametr, limit) muszą
    // propagować się dalej, żeby poller/tick zamienił je w `stale`, zamiast po cichu maskować
    // realną awarię jako "rozjazd ±1 bloku".
    if (!isArchiveError(e)) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    log(`live: eth_call z tagiem ${tag} odrzucone (${msg.slice(0, 120)}) — fallback na latest`);
    consistent = false;
    results = await rpc.batch<unknown>([...reserveRequests(pools, "latest"), logsReq]);
  }
  const reservesByAddr = new Map<string, { reserve0: bigint; reserve1: bigint }>();
  pools.forEach((p, i) => reservesByAddr.set(p.address.toLowerCase(), decodeReserves(results[i] as string)));
  const logs = (results[pools.length] as RawLiveLog[] | undefined) ?? [];
  const swapsByAddr = new Map<string, number>();
  for (const l of logs) {
    const a = l.address.toLowerCase();
    swapsByAddr.set(a, (swapsByAddr.get(a) ?? 0) + 1);
  }

  // Stany obu pul per para (jak PairBlockState w trybie historycznym).
  const states = new Map<number, PairBlockState>();
  for (const pair of pairs) {
    const a = toPoolState(pair.poolA, pair, reservesByAddr.get(pair.poolA.address.toLowerCase())!);
    const b = toPoolState(pair.poolB, pair, reservesByAddr.get(pair.poolB.address.toLowerCase())!);
    states.set(pair.id, { block, a, b, spreadPct: spreadPct(a.price, b.price) });
  }

  // Kurs ETH/USD: pula A pary referencyjnej (jak `refEthUsd` w analyzePairWindow).
  const refPair = pairs.find((p) => p.symbol === REFERENCE_PAIR_SYMBOL);
  const refState = refPair ? states.get(refPair.id) : undefined;
  if (pairs.length > 0 && !refState) {
    throw new Error(`live: brak pary referencyjnej ${REFERENCE_PAIR_SYMBOL} w katalogu — kurs ETH/USD nieokreślony`);
  }
  const ethUsdRef = refState ? refState.a.price : 0;
  const refEthUsd = () => ethUsdRef;

  const pairSamples: LivePairSample[] = pairs.map((pair) => {
    const st = states.get(pair.id)!;
    const q = makeQuoteUsd(pair.quoteSymbol, refEthUsd)(block, st);
    const ethUsd = makeEthUsd(pair.quoteSymbol, pair.baseSymbol, refEthUsd)(block, st.a.price);
    const tvlMinUsd = Math.min(st.a.tvlQuote, st.b.tvlQuote) * q;
    const arb = arbitrage(st.a, st.b, pair.poolA.feeBps);
    const toUsd = (x: bigint) => (Number(x) / 10 ** pair.decQuote) * q;
    const optTradeUsd = toUsd(arb.tradeIn);
    const grossProfitUsd = toUsd(arb.profit);
    const netProfitUsd = arb.direction === "none" ? 0 : baselineNetProfitUsd(grossProfitUsd, gasGwei, ethUsd);
    const swaps = (swapsByAddr.get(pair.poolA.address.toLowerCase()) ?? 0) + (swapsByAddr.get(pair.poolB.address.toLowerCase()) ?? 0);
    const poolSample = (pool: LivePool, s: PoolState): LivePoolSample => ({
      dexName: pool.dexName, price: s.price, reserveBase: s.base, reserveQuote: s.quote, tvlQuote: s.tvlQuote,
    });
    return {
      pairId: pair.id,
      symbol: pair.symbol,
      poolA: poolSample(pair.poolA, st.a),
      poolB: poolSample(pair.poolB, st.b),
      spreadPct: st.spreadPct,
      direction: DIRECTION[arb.direction],
      optTradeUsd,
      grossProfitUsd,
      netProfitUsd,
      tvlMinUsd,
      ethUsd,
      swapsPerBlock: swaps / LIVE_SWAP_LOOKBACK_BLOCKS,
    };
  });

  return {
    at: now().toISOString(),
    block,
    blockTimestamp: hexToNumber(blk.timestamp),
    baseFeeGwei,
    gasGwei,
    ethUsd: ethUsdRef,
    consistent,
    pairs: pairSamples,
  };
}
