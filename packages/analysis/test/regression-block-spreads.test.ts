import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPairStates, type SyncRow } from "../src/reserveStates.js";
import { PROJECT_DATA, projectFile, readCsv } from "./helpers/csv.js";

describe.skipIf(!PROJECT_DATA)("regresja: stany bloków vs block_spreads.csv (maj 2021)", () => {
  it("77 388 bloków; ceny |Δ|<1e-3, spread |Δ|<1e-4 pp, TVL |Δ|<1e-3 mln", () => {
    const syncs: SyncRow[] = [];
    for (const line of fs.readFileSync(projectFile("events.csv"), "utf8").split("\n")) {
      const p = line.split(",");
      if (p[3] !== "sync") continue;
      syncs.push({
        poolId: p[2] === "uniswap" ? 1 : 2, block: +p[0]!, logIndex: +p[1]!,
        reserve0: BigInt(p[5]!), reserve1: BigInt(p[6]!),
      });
    }
    syncs.sort((x, y) => x.block - y.block || x.logIndex - y.logIndex);
    const ref = readCsv(projectFile("block_spreads.csv"));
    const toBlock = +ref[ref.length - 1]!.block!;
    const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
    const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
    const pairSpec = { tokenBase: WETH, tokenQuote: USDC, decBase: 18, decQuote: 6 };
    const spec = { token0: USDC, token1: WETH };
    const st = buildPairStates(syncs, { poolId: 1, ...spec }, { poolId: 2, ...spec }, pairSpec, toBlock);
    expect(st).toHaveLength(ref.length);
    expect(st[0]!.block).toBe(+ref[0]!.block!); // 12429206
    for (let i = 0; i < ref.length; i++) {
      const r = ref[i]!, s = st[i]!;
      expect(s.block).toBe(+r.block!);
      expect(s.a.price).toBeCloseTo(+r.priceUni!, 3);
      expect(s.b.price).toBeCloseTo(+r.priceSushi!, 3);
      expect(s.spreadPct).toBeCloseTo(+r.spreadPct!, 3);
      expect(Math.min(s.a.tvlQuote, s.b.tvlQuote) / 1e6).toBeCloseTo(+r.tvlMinMlnUsd!, 2);
    }
  }, 120_000);
});
