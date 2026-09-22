// Jedna prawdziwa próbka z eRPC użytkownika (spec §9, E2E): kurs ETH i spread WETH/USDC z
// `sampleLive` porównane z ręcznym eth_call getReserves na obu pulach (ten sam blok, więc
// równość dokładna; przy fallbacku na `latest` dopuszczamy 0,5 % rozjazdu). Pomijany bez RPC_URL
// (uruchomienie: `RPC_URL=... npx vitest run test/live/sample.live.test.ts`; `npm test` w
// analysis nie ładuje .env, więc w CI jest zawsze pomijany).
import { describe, it, expect } from "vitest";
import { RpcClient } from "@dex-arb/ingest";
import { priceFromReserves, spreadPct } from "@dex-arb/core";
import { GET_RESERVES_SELECTOR, decodeReserves } from "../../src/live/rpcTypes.js";
import { sampleLive } from "../../src/live/sample.js";
import { SUSHI_POOL, UNI_POOL, WETH_USDC_PAIR } from "./fixtures.js";

const RPC_URL = process.env.RPC_URL;

describe.skipIf(!RPC_URL)("sampleLive na prawdziwym eRPC", () => {
  it("kurs ETH/USD i spread zgodne z ręcznym eth_call getReserves", async () => {
    const rpc = new RpcClient({ urls: [RPC_URL!], maxTries: 2, baseDelayMs: 500, log: () => {} });
    const s = await sampleLive(rpc, [WETH_USDC_PAIR]);
    expect(s.block).toBeGreaterThan(20_000_000);
    expect(s.gasGwei).toBeGreaterThan(2);
    const p = s.pairs[0]!;

    const tag = s.consistent ? "0x" + s.block.toString(16) : "latest";
    const [uniHex, sushiHex] = await rpc.batch<string>([
      { method: "eth_call", params: [{ to: UNI_POOL, data: GET_RESERVES_SELECTOR }, tag] },
      { method: "eth_call", params: [{ to: SUSHI_POOL, data: GET_RESERVES_SELECTOR }, tag] },
    ]);
    const uni = decodeReserves(uniHex!);
    const sushi = decodeReserves(sushiHex!);
    // token0 = USDC (quote), token1 = WETH (base) w obu pulach
    const priceUni = priceFromReserves(uni.reserve1, 18, uni.reserve0, 6);
    const priceSushi = priceFromReserves(sushi.reserve1, 18, sushi.reserve0, 6);
    const tol = s.consistent ? 1e-9 : 0.005;
    expect(Math.abs(p.poolA.price - priceUni) / priceUni).toBeLessThanOrEqual(tol);
    expect(Math.abs(p.poolB.price - priceSushi) / priceSushi).toBeLessThanOrEqual(tol);
    expect(Math.abs(s.ethUsd - priceUni) / priceUni).toBeLessThanOrEqual(tol);
    if (s.consistent) expect(p.spreadPct).toBeCloseTo(spreadPct(priceUni, priceSushi), 9);
    console.log(`live smoke: blok ${s.block}, ETH/USD ${s.ethUsd.toFixed(2)}, spread ${p.spreadPct.toFixed(4)} %, consistent=${s.consistent}`);
  }, 30_000);
});
