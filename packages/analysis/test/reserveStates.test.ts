import { describe, expect, it } from "vitest";
import { buildPairStates, poolStateFromReserves, type PairSpec, type PoolSpec, type SyncRow } from "../src/reserveStates.js";

const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const WBTC = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";

// WETH/USDC: token0 = USDC (obie pule), token1 = WETH — base (WETH) jest token1.
const PAIR_WETH_USDC: PairSpec = { tokenBase: WETH, tokenQuote: USDC, decBase: 18, decQuote: 6 };
const A: PoolSpec = { poolId: 1, token0: USDC, token1: WETH };
const B: PoolSpec = { poolId: 2, token0: USDC, token1: WETH };
const s = (poolId: number, block: number, logIndex: number, r0: bigint, r1: bigint): SyncRow =>
  ({ poolId, block, logIndex, reserve0: r0, reserve1: r1 });

describe("buildPairStates", () => {
  it("zaczyna od pierwszego bloku z obiema pulami i przenosi stan w przód", () => {
    const st = buildPairStates([
      s(1, 100, 5, 4000n * 10n ** 6n, 1n * 10n ** 18n),   // A: 4000 USDC/WETH
      s(2, 102, 1, 4100n * 10n ** 6n, 1n * 10n ** 18n),   // B: 4100
      s(1, 104, 3, 4200n * 10n ** 6n, 1n * 10n ** 18n),   // A: 4200
    ], A, B, PAIR_WETH_USDC, 105);
    expect(st.map((x) => x.block)).toEqual([102, 103, 104, 105]);
    expect(st[0].a.price).toBeCloseTo(4000);
    expect(st[0].b.price).toBeCloseTo(4100);
    expect(st[0].spreadPct).toBeCloseTo(2.5);
    expect(st[1]).toMatchObject({ block: 103, spreadPct: st[0].spreadPct });
    expect(st[2].a.price).toBeCloseTo(4200);
    expect(st[2].spreadPct).toBeCloseTo((100 / 4100) * 100);
  });
  it("w bloku z wieloma Syncami bierze największy logIndex", () => {
    const st = buildPairStates([
      s(1, 10, 7, 4000n * 10n ** 6n, 10n ** 18n),
      s(1, 10, 2, 9999n * 10n ** 6n, 10n ** 18n),
      s(2, 10, 1, 4000n * 10n ** 6n, 10n ** 18n),
    ], A, B, PAIR_WETH_USDC, 10);
    expect(st).toHaveLength(1);
    expect(st[0].a.price).toBeCloseTo(4000);
    expect(st[0].a.tvlQuote).toBeCloseTo(8000);
  });
  it("pusta lista -> pusta tablica", () => {
    expect(buildPairStates([], A, B, PAIR_WETH_USDC, 10)).toEqual([]);
  });

  it("WETH/USDT (token0=WETH, jedyna taka para): orientacja przez orientPool, base jest token0", () => {
    const pair: PairSpec = { tokenBase: WETH, tokenQuote: USDT, decBase: 18, decQuote: 6 };
    const poolA: PoolSpec = { poolId: 1, token0: WETH, token1: USDT };
    const poolB: PoolSpec = { poolId: 2, token0: WETH, token1: USDT };
    const st = buildPairStates([
      s(1, 1, 0, 1_000n * 10n ** 18n, 4_000_000n * 10n ** 6n),
      s(2, 1, 0, 1_000n * 10n ** 18n, 4_000_000n * 10n ** 6n),
    ], poolA, poolB, pair, 1);
    expect(st[0].a.price).toBeCloseTo(4000);
    expect(st[0].b.price).toBeCloseTo(4000);
    expect(st[0].a.tvlQuote).toBeCloseTo(8_000_000); // 2x strona USDT (quote)
  });

  it("WBTC/WETH (8/18 dec, quote=WETH): TVL i cena liczone ze strony WETH przez quotePerBase", () => {
    const pair: PairSpec = { tokenBase: WBTC, tokenQuote: WETH, decBase: 8, decQuote: 18 };
    const poolA: PoolSpec = { poolId: 1, token0: WBTC, token1: WETH };
    const poolB: PoolSpec = { poolId: 2, token0: WBTC, token1: WETH };
    const st = buildPairStates([
      s(1, 1, 0, 100n * 10n ** 8n, 1_500n * 10n ** 18n), // 15 WETH/WBTC
      s(2, 1, 0, 100n * 10n ** 8n, 1_500n * 10n ** 18n),
    ], poolA, poolB, pair, 1);
    expect(st[0].a.price).toBeCloseTo(15, 9);
    expect(st[0].a.tvlQuote).toBeCloseTo(3_000); // 2 x 1500 WETH
  });
});

describe("poolStateFromReserves (helper współdzielony z live/sample.ts toPoolState)", () => {
  it("daje ten sam PoolState co buildPairStates dla tych samych rezerw (parzystość toState/toPoolState)", () => {
    const r0 = 4000n * 10n ** 6n;
    const r1 = 1n * 10n ** 18n;
    const direct = poolStateFromReserves(r0, r1, A, PAIR_WETH_USDC);
    const st = buildPairStates([s(1, 1, 0, r0, r1), s(2, 1, 0, r0, r1)], A, B, PAIR_WETH_USDC, 1);
    expect(st).toHaveLength(1);
    expect(st[0].a).toEqual(direct);
  });
});
