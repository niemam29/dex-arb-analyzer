/**
 * Orientacja puli x·y=k: mapowanie rezerw `reserve0`/`reserve1` na
 * `reserveBase`/`reserveQuote` niezależnie od tego, który token jest `token0` w danej puli
 * (Uniswap V2/Sushiswap sortują token0 < token1 wg adresu — dla różnych par to raz base, raz
 * quote, patrz np. WETH/USDT gdzie WETH jest token0, w przeciwieństwie do WETH/USDC/DAI/WBTC).
 * Cena `quotePerBase` jest zbudowana na istniejącym `priceFromReserves(reserveBase, decBase,
 * reserveQuote, decQuote)` z `amm.ts` — nie duplikuje jego arytmetyki.
 */
import { priceFromReserves } from "./amm.js";

export interface RawPool {
  token0: string;
  token1: string;
  reserve0: bigint;
  reserve1: bigint;
}

export interface PairSpec {
  tokenBase: string;
  tokenQuote: string;
  decBase: number;
  decQuote: number;
}

export interface OrientedPool {
  reserveBase: bigint;
  reserveQuote: bigint;
  baseIsToken0: boolean;
}

/** Dopasowuje `pool.token0`/`token1` do `pair.tokenBase`/`tokenQuote` (porównanie bez uwzględniania
 *  wielkości liter) i zwraca rezerwy przemapowane na base/quote. Rzuca, gdy tokeny puli nie
 *  odpowiadają tokenom pary (np. zły wiersz z bazy albo pomyłka w konfiguracji). */
export function orientPool(pool: RawPool, pair: PairSpec): OrientedPool {
  const t0 = pool.token0.toLowerCase();
  const t1 = pool.token1.toLowerCase();
  const base = pair.tokenBase.toLowerCase();
  const quote = pair.tokenQuote.toLowerCase();

  if (t0 === base && t1 === quote) {
    return { reserveBase: pool.reserve0, reserveQuote: pool.reserve1, baseIsToken0: true };
  }
  if (t0 === quote && t1 === base) {
    return { reserveBase: pool.reserve1, reserveQuote: pool.reserve0, baseIsToken0: false };
  }
  throw new Error(
    `Tokeny puli (${pool.token0}, ${pool.token1}) nie odpowiadają tokenom pary (${pair.tokenBase}, ${pair.tokenQuote})`,
  );
}

/** Cena tokena bazowego w jednostkach tokena kwotowanego, z puli już zorientowanej `orientPool`-em. */
export function quotePerBase(oriented: OrientedPool, decBase: number, decQuote: number): number {
  return priceFromReserves(oriented.reserveBase, decBase, oriented.reserveQuote, decQuote);
}
