/**
 * Odtworzenie stanu rezerw obu puli (Uniswap V2 + Sushiswap) blok po bloku z surowych
 * zdarzeń Sync — czysta funkcja, bez dostępu do bazy (odpowiednik w implementacji referencyjnej,
 * ten sam algorytm: stan puli w bloku = Sync o największym `logIndex` w tym bloku, bloki
 * bez Synca dziedziczą stan poprzedni).
 *
 * Orientacja rezerw (który token jest base/quote) i cena liczone są przez `orientPool`/
 * `quotePerBase` z `@dex-arb/core` — bez zakładania z góry, który token jest
 * `token0` w danej puli (dla WETH/USDC/DAI/WBTC base jest token1, dla WETH/USDT — token0).
 */
import { orientPool, quotePerBase, spreadPct, type PairSpec as CorePairSpec, type RawPool } from "@dex-arb/core";

export interface SyncRow {
  poolId: number;
  block: number;
  logIndex: number;
  reserve0: bigint;
  reserve1: bigint;
}

/** Tożsamość puli (adresy token0/token1 wg kontraktu) — reszta orientacji liczona przez `orientPool`. */
export interface PoolSpec {
  poolId: number;
  token0: string;
  token1: string;
}

/** Tokeny i liczba miejsc dziesiętnych pary logicznej — wspólne dla obu pul (A i B). */
export type PairSpec = CorePairSpec;

export interface PoolState {
  base: bigint;
  quote: bigint;
  price: number;
  /** 2× strona quote (TVL puli w jednostkach quote — obie strony razem, przybliżenie 2·quote). */
  tvlQuote: number;
}

export interface PairBlockState {
  block: number;
  a: PoolState;
  b: PoolState;
  spreadPct: number;
}

/**
 * Konwencja stosowana w całym etapie 2 (`analyze`, `verify`): `a` = pula Uniswap V2,
 * `b` = pula Sushiswap. Funkcja `buildPairStates` sama jest generyczna względem
 * `poolA`/`poolB` (kolejność ustala wywołujący), ale poza testami trzymamy się tej konwencji.
 * Wartości to dokładne (małymi literami) nazwy `dexes.name` z bazy (patrz `seed-data.ts`) —
 * `loadPairWindowInputs` dopasowuje je przez równość, nie prefiks, żeby np. przyszły
 * "uniswap-v3" nie trafił omyłkowo w tę samą regułę co "uniswap-v2".
 */
export const PAIR_CONVENTION = { a: "uniswap-v2", b: "sushiswap" } as const;
export type PairSide = keyof typeof PAIR_CONVENTION;

/** Tożsamość puli, wystarczająca do orientacji rezerw (`token0`/`token1`) — podzbiór `PoolSpec`. */
export interface ReservePoolSpec {
  token0: string;
  token1: string;
}

/**
 * Stan jednej puli z surowych rezerw (`reserve0`/`reserve1`) — jedyne miejsce, gdzie liczymy
 * `PoolState` (base/quote, cena, TVL) przez `orientPool`/`quotePerBase`. Współdzielone przez tryb
 * historyczny (`toState` niżej, wejście: `SyncRow`) i panel na żywo (`toPoolState` w
 * `live/sample.ts`, wejście: `eth_call getReserves()`) — ta sama arytmetyka dla obu ścieżek
 * (patrz test parzystości w `reserveStates.test.ts` / `live/sample.test.ts`).
 */
export function poolStateFromReserves(reserve0: bigint, reserve1: bigint, spec: ReservePoolSpec, pair: PairSpec): PoolState {
  const raw: RawPool = { token0: spec.token0, token1: spec.token1, reserve0, reserve1 };
  const oriented = orientPool(raw, pair);
  return {
    base: oriented.reserveBase,
    quote: oriented.reserveQuote,
    price: quotePerBase(oriented, pair.decBase, pair.decQuote),
    tvlQuote: (2 * Number(oriented.reserveQuote)) / 10 ** pair.decQuote,
  };
}

function toState(row: SyncRow, spec: PoolSpec, pair: PairSpec): PoolState {
  return poolStateFromReserves(row.reserve0, row.reserve1, spec, pair);
}

/**
 * Ostatni Sync (max `logIndex`) w każdym bloku dla jednej puli — reguła współdzielona
 * z `buildPairStates`, do ponownego użycia w kolejnych etapach (analyze, verify).
 */
export function lastSyncPerBlock(syncs: Iterable<SyncRow>, poolId: number): Map<number, SyncRow> {
  const last = new Map<number, SyncRow>();
  for (const row of syncs) {
    if (row.poolId !== poolId) continue;
    const cur = last.get(row.block);
    if (!cur || row.logIndex > cur.logIndex) last.set(row.block, row);
  }
  return last;
}

/**
 * Stan obu puli po każdym bloku: ostatni Sync (max logIndex) w bloku, inaczej stan poprzedni.
 * Wejście nie musi być posortowane — `lastSyncPerBlock` samo wyłania maksimum per blok.
 * Wynik: od pierwszego bloku, w którym OBIE pule mają już jakiś stan, do `toBlock` włącznie.
 */
export function buildPairStates(
  syncs: Iterable<SyncRow>,
  poolA: PoolSpec,
  poolB: PoolSpec,
  pair: PairSpec,
  toBlock: number,
): PairBlockState[] {
  const rows = Array.isArray(syncs) ? syncs : Array.from(syncs);
  const lastA = lastSyncPerBlock(rows, poolA.poolId);
  const lastB = lastSyncPerBlock(rows, poolB.poolId);

  let minBlock = Infinity;
  for (const blk of lastA.keys()) if (blk < minBlock) minBlock = blk;
  for (const blk of lastB.keys()) if (blk < minBlock) minBlock = blk;

  const out: PairBlockState[] = [];
  if (minBlock === Infinity) return out;

  let a: PoolState | null = null;
  let b: PoolState | null = null;
  for (let blk = minBlock; blk <= toBlock; blk++) {
    const ra = lastA.get(blk);
    const rb = lastB.get(blk);
    if (ra) a = toState(ra, poolA, pair);
    if (rb) b = toState(rb, poolB, pair);
    if (!a || !b) continue;
    out.push({ block: blk, a, b, spreadPct: spreadPct(a.price, b.price) });
  }
  return out;
}
