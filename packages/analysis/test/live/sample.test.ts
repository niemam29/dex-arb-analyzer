import { describe, it, expect } from "vitest";
import { decodeReserves, isArchiveError, toHexBlock, GET_RESERVES_SELECTOR, TOPIC_SWAP_V2 } from "../../src/live/rpcTypes.js";
import { sampleLive } from "../../src/live/sample.js";
import { buildPairStates, type PairSpec, type PoolSpec } from "../../src/reserveStates.js";
import {
  BLOCK_12488033, SUSHI_POOL, SUSHI_RESERVES_12488033, SUSHI_RESERVES_SPREAD_1PCT, UNI_POOL, UNI_RESERVES_12488033,
  USDC, WETH, WETH_USDC_PAIR, encodeReserves, makeFakeRpc,
} from "./fixtures.js";

describe("decodeReserves / toHexBlock", () => {
  it("dekoduje 3 słowa uint z odpowiedzi getReserves", () => {
    const hex = encodeReserves(112928425898061n, 49178419840355489216087n, 0x60a9c4c0);
    expect(decodeReserves(hex)).toEqual({ reserve0: 112928425898061n, reserve1: 49178419840355489216087n, blockTimestampLast: 1621738688 });
    expect(() => decodeReserves("0x1234")).toThrow(/getReserves/);
  });
  it("toHexBlock: 12488033 -> 0xbe8d61; selector i topic Swap V2", () => {
    expect(toHexBlock(12488033)).toBe("0xbe8d61");
    expect(GET_RESERVES_SELECTOR).toBe("0x0902f1ac");
    expect(TOPIC_SWAP_V2).toBe("0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822");
  });
});

describe("sampleLive", () => {
  const now = () => new Date("2026-08-27T10:00:00.000Z");

  it("blok 12 488 033 (rezerwy rzeczywiste): spread 0,00078 %, brak kierunku, zysk 0, kurs ETH z puli A", async () => {
    const rpc = makeFakeRpc({ reserves: { [UNI_POOL]: UNI_RESERVES_12488033, [SUSHI_POOL]: SUSHI_RESERVES_12488033 } });
    const s = await sampleLive(rpc, [WETH_USDC_PAIR], { now });
    expect(s.block).toBe(12488033);
    expect(s.blockTimestamp).toBe(BLOCK_12488033.timestamp);
    expect(s.at).toBe("2026-08-27T10:00:00.000Z");
    expect(s.baseFeeGwei).toBe(10);
    expect(s.gasGwei).toBe(12);
    expect(s.consistent).toBe(true);
    expect(s.ethUsd).toBeCloseTo(2296.3004151953796, 6);
    const p = s.pairs[0]!;
    expect(p.poolA.price).toBeCloseTo(2296.3004151953796, 6);
    expect(p.poolB.price).toBeCloseTo(2296.282462553197, 6);
    expect(p.spreadPct).toBeCloseTo(0.0007818133211092222, 12);
    expect(p.direction).toBe("none");
    expect(p.optTradeUsd).toBe(0);
    expect(p.grossProfitUsd).toBe(0);
    expect(p.netProfitUsd).toBe(0);
    expect(p.tvlMinUsd).toBeCloseTo(225856851.796122, 3);
    expect(p.ethUsd).toBeCloseTo(2296.3004151953796, 6);
    expect(p.swapsPerBlock).toBe(0);
  });

  it("spread ~1 %: kierunek a_to_b, optymalna transakcja i zysk brutto/netto jak w block_states", async () => {
    const rpc = makeFakeRpc({
      reserves: { [UNI_POOL]: UNI_RESERVES_12488033, [SUSHI_POOL]: SUSHI_RESERVES_SPREAD_1PCT },
      logs: [
        { address: UNI_POOL, blockNumber: "0xbe8d61" },
        { address: UNI_POOL, blockNumber: "0xbe8d60" },
        { address: SUSHI_POOL, blockNumber: "0xbe8d5f" },
      ],
    });
    const s = await sampleLive(rpc, [WETH_USDC_PAIR], { now });
    const p = s.pairs[0]!;
    expect(p.poolB.price).toBeCloseTo(2319.5712139119696, 6);
    expect(p.spreadPct).toBeCloseTo(1.0134039328042361, 10);
    expect(p.direction).toBe("a_to_b");
    expect(p.optTradeUsd).toBeCloseTo(141015.294741, 6);
    expect(p.grossProfitUsd).toBeCloseTo(287.542061, 6);
    // netto = brutto − 220 000 · 12 gwei · 2296,30 USD = 287,54 − 6,06
    expect(p.netProfitUsd).toBeCloseTo(281.4798279038842, 6);
    expect(p.swapsPerBlock).toBeCloseTo(3 / 20, 12);
  });

  it("wysyła 2 batche: [getBlockByNumber latest], potem 8×eth_call z tagiem hex + getLogs [n-19, n]", async () => {
    const pair2 = { ...WETH_USDC_PAIR, id: 2, symbol: "WETH/USDT", quoteSymbol: "USDT", poolA: { ...WETH_USDC_PAIR.poolA, address: "0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852" }, poolB: { ...WETH_USDC_PAIR.poolB, address: "0x06da0fd433c1a5d7a4faa01111c044910a184553" } };
    const rpc = makeFakeRpc({
      reserves: {
        [UNI_POOL]: UNI_RESERVES_12488033,
        [SUSHI_POOL]: SUSHI_RESERVES_12488033,
        "0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852": UNI_RESERVES_12488033,
        "0x06da0fd433c1a5d7a4faa01111c044910a184553": SUSHI_RESERVES_12488033,
      },
    });
    await sampleLive(rpc, [WETH_USDC_PAIR, pair2], { now });
    expect(rpc.calls).toHaveLength(2);
    expect(rpc.calls[0]).toEqual([{ method: "eth_getBlockByNumber", params: ["latest", false] }]);
    const second = rpc.calls[1]!;
    expect(second).toHaveLength(5);
    expect(second[0]).toEqual({ method: "eth_call", params: [{ to: UNI_POOL, data: GET_RESERVES_SELECTOR }, "0xbe8d61"] });
    expect(second[4]).toEqual({
      method: "eth_getLogs",
      params: [{ address: [UNI_POOL, SUSHI_POOL, "0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852", "0x06da0fd433c1a5d7a4faa01111c044910a184553"], topics: [TOPIC_SWAP_V2], fromBlock: "0xbe8d4e", toBlock: "0xbe8d61" }],
    });
  });

  it("eRPC bez archiwum odrzuca eth_call z tagiem hex -> fallback na latest, consistent=false", async () => {
    const log: string[] = [];
    const rpc = makeFakeRpc({ reserves: { [UNI_POOL]: UNI_RESERVES_12488033, [SUSHI_POOL]: SUSHI_RESERVES_12488033 }, rejectArchiveCalls: true });
    const s = await sampleLive(rpc, [WETH_USDC_PAIR], { now, log: (m) => log.push(m) });
    expect(s.consistent).toBe(false);
    expect(s.pairs[0]!.poolA.price).toBeCloseTo(2296.3004151953796, 6);
    expect(rpc.calls).toHaveLength(3);
    expect((rpc.calls[2]![0]!.params as unknown[])[1]).toBe("latest");
    expect(log.some((m) => m.includes("latest"))).toBe(true);
  });

  it("błąd RPC NIE-archiwalny (np. zły parametr) propaguje się bez fallbacku na latest", async () => {
    const rpc = makeFakeRpc({ reserves: { [UNI_POOL]: UNI_RESERVES_12488033, [SUSHI_POOL]: SUSHI_RESERVES_12488033 }, rejectNonArchiveCalls: true });
    await expect(sampleLive(rpc, [WETH_USDC_PAIR], { now })).rejects.toThrow(/-32602/);
    // tylko 2 batche (getBlockByNumber + próba z tagiem hex) — bez trzeciego batcha "fallback na latest"
    expect(rpc.calls).toHaveLength(2);
  });

  it("isArchiveError: rozpoznaje kod -32000 i frazy archiwalne, odrzuca inne błędy", () => {
    expect(isArchiveError(new Error("RPC -32000: missing trie node in state trie"))).toBe(true);
    expect(isArchiveError(Object.assign(new Error("boom"), { code: -32000 }))).toBe(true);
    expect(isArchiveError(new Error("query returned more than 10000 results (archive node required)"))).toBe(true);
    expect(isArchiveError(new Error("RPC -32602: invalid params"))).toBe(false);
    expect(isArchiveError("nie-Error")).toBe(false);
  });

  it("parzystość z trybem historycznym: te same rezerwy dają ten sam PoolState przez toPoolState (live) i buildPairStates (historyczny)", async () => {
    const rpc = makeFakeRpc({ reserves: { [UNI_POOL]: UNI_RESERVES_12488033, [SUSHI_POOL]: SUSHI_RESERVES_12488033 } });
    const s = await sampleLive(rpc, [WETH_USDC_PAIR], { now });
    const pairSpec: PairSpec = { tokenBase: WETH, tokenQuote: USDC, decBase: 18, decQuote: 6 };
    const poolA: PoolSpec = { poolId: 1, token0: USDC, token1: WETH };
    const poolB: PoolSpec = { poolId: 2, token0: USDC, token1: WETH };
    const hist = buildPairStates(
      [
        { poolId: 1, block: 1, logIndex: 0, reserve0: UNI_RESERVES_12488033.reserve0, reserve1: UNI_RESERVES_12488033.reserve1 },
        { poolId: 2, block: 1, logIndex: 0, reserve0: SUSHI_RESERVES_12488033.reserve0, reserve1: SUSHI_RESERVES_12488033.reserve1 },
      ],
      poolA, poolB, pairSpec, 1,
    );
    const p = s.pairs[0]!;
    expect(p.poolA.price).toBe(hist[0]!.a.price);
    expect(p.poolA.reserveBase).toBe(hist[0]!.a.base);
    expect(p.poolA.reserveQuote).toBe(hist[0]!.a.quote);
    expect(p.poolA.tvlQuote).toBe(hist[0]!.a.tvlQuote);
    expect(p.poolB.price).toBe(hist[0]!.b.price);
  });

  it("para kwotowana w WETH używa kursu z pary referencyjnej; brak pary referencyjnej -> błąd", async () => {
    const wbtcWeth = {
      ...WETH_USDC_PAIR, id: 4, symbol: "WBTC/WETH",
      tokenBase: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", tokenQuote: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      decBase: 8, decQuote: 18, baseSymbol: "WBTC", quoteSymbol: "WETH",
      poolA: { address: "0xbb2b8038a1640196fbe3e38816f3e67cba72d940", token0: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", token1: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", dexName: "uniswap-v2", feeBps: 30 },
      poolB: { address: "0xceff51756c56ceffca006cd410b03ffc46dd3a58", token0: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", token1: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", dexName: "sushiswap", feeBps: 30 },
    };
    // 100 WBTC ↔ 1 600 WETH w obu pulach (16 WETH za 1 WBTC)
    const wbtcRes = { reserve0: 100_00000000n, reserve1: 1600n * 10n ** 18n };
    const rpc = makeFakeRpc({
      reserves: { [UNI_POOL]: UNI_RESERVES_12488033, [SUSHI_POOL]: SUSHI_RESERVES_12488033, [wbtcWeth.poolA.address]: wbtcRes, [wbtcWeth.poolB.address]: wbtcRes },
    });
    const s = await sampleLive(rpc, [WETH_USDC_PAIR, wbtcWeth], { now });
    const p = s.pairs[1]!;
    expect(p.poolA.price).toBeCloseTo(16, 9);
    // TVL puli = 2 · 1600 WETH · 2296,30 USD
    expect(p.tvlMinUsd).toBeCloseTo(2 * 1600 * 2296.3004151953796, 3);
    expect(p.ethUsd).toBeCloseTo(2296.3004151953796, 6);
    await expect(sampleLive(rpc, [wbtcWeth], { now })).rejects.toThrow(/WETH\/USDC/);
  });
});
