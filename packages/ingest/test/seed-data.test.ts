// Testy funkcji czystych z seed-data.ts: kalldata getPair, dekodowanie adresu,
// spójność referencji między POOLS/PAIRS/DEXES/TOKENS.
import { describe, it, expect } from "vitest";
import { getPairCalldata, decodeAddress, PAIR_ERC20_IFACE, POOLS, TOKENS, PAIRS, DEXES, WINDOWS } from "../src/seed-data.js";

describe("seed-data", () => {
  it("getPair calldata ma selektor 0xe6a43905 i dwa adresy", () => {
    const cd = getPairCalldata("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    expect(cd.slice(0, 10)).toBe("0xe6a43905");
    expect(cd.length).toBe(2 + 8 + 64 * 2);
  });

  it("decodeAddress z 32-bajtowego słowa", () => {
    expect(decodeAddress("0x000000000000000000000000b4e16d0168e52d35cacd2c6185b44281ec28c9dc")).toBe(
      "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc",
    );
  });

  it("PAIR_ERC20_IFACE koduje token0()/token1() bez argumentów", () => {
    expect(PAIR_ERC20_IFACE.encodeFunctionData("token0")).toBe("0x0dfe1681");
    expect(PAIR_ERC20_IFACE.encodeFunctionData("token1")).toBe("0xd21220a7");
  });

  it("spójność referencji: każdy POOL wskazuje istniejący dex i parę; pary na istniejące tokeny", () => {
    for (const p of POOLS) {
      expect(DEXES.map((d) => d.name)).toContain(p.dex);
      expect(PAIRS.map((x) => x.symbol)).toContain(p.pair);
    }
    for (const p of PAIRS) for (const s of [p.base, p.quote]) expect(TOKENS.map((t) => t.symbol)).toContain(s);
    expect(POOLS.length).toBe(8);
  });

  it("wszystkie adresy tokenów, DEX-ów i pul są małymi literami i poprawnym adresem EVM (docs/konwencje.md „Decyzje”, zgodność ze Stage-0 packages/db)", async () => {
    const { getAddress } = await import("ethers");
    for (const t of TOKENS) {
      expect(t.address).toBe(t.address.toLowerCase());
      expect(getAddress(t.address).toLowerCase()).toBe(t.address);
    }
    for (const d of DEXES) {
      expect(d.factory).toBe(d.factory.toLowerCase());
      expect(getAddress(d.factory).toLowerCase()).toBe(d.factory);
    }
    for (const p of POOLS) {
      if (!p.address) continue;
      expect(p.address).toBe(p.address.toLowerCase());
      expect(getAddress(p.address).toLowerCase()).toBe(p.address);
    }
  });

  it("nazwy dex-ów, symbole par i nazwy okien są takie same jak w usuniętym Stage-0 seedzie (packages/db/src/seed.ts) — jeden seed, jedna konwencja nazw", () => {
    expect(DEXES.map((d) => d.name)).toEqual(["uniswap-v2", "sushiswap"]);
    expect(PAIRS.map((p) => p.symbol)).toEqual(["WETH/USDC", "WETH/USDT", "WETH/DAI", "WBTC/WETH"]);
    expect(WINDOWS.map((w) => w.name)).toEqual(["2021-05 krach", "2021-11 ATH", "2022-05 Luna", "2022-11 FTX"]);
  });

  it("każda para (dex, pair) w POOLS jest unikalna — dokładnie 2 DEX-y × 4 pary", () => {
    const keys = new Set(POOLS.map((p) => `${p.dex}|${p.pair}`));
    expect(keys.size).toBe(8);
  });

  it("okna mają oczekiwane granice bloków (zapis z bazy dev po pełnej macierzy) — rosnące, rozłączne, zgodne z datami", () => {
    const expected = [
      [12_429_199, 12_506_592],
      [13_553_257, 13_642_393],
      [14_713_964, 14_801_795],
      [15_900_096, 16_000_337],
    ];
    WINDOWS.forEach((w, i) => {
      expect([w.fromBlock, w.toBlock]).toEqual(expected[i]);
      expect(w.toBlock).toBeGreaterThan(w.fromBlock);
      if (i > 0) expect(w.fromBlock).toBeGreaterThan(WINDOWS[i - 1]!.toBlock);
      // ~13 s/blok w 2021–22: 12–14 dni okna = 77–101 tys. bloków
      expect(w.toBlock - w.fromBlock).toBeGreaterThan(70_000);
      expect(w.toBlock - w.fromBlock).toBeLessThan(110_000);
    });
  });

  // Stałe niezależnie przepisane z zapisu weryfikacji on-chain (nie z seed-data.ts) — regresja
  // wykrywa przypadkową zmianę adresu/decimals w seed-data.ts, nie tylko wewnętrzną spójność
  // tego pliku.
  describe("audyt: zgodność z weryfikacją on-chain", () => {
    const ONCHAIN_TOKENS: Record<string, number> = {
      weth: 18,
      usdc: 6,
      usdt: 6,
      dai: 18,
      wbtc: 8,
    };
    // adres puli -> [token0, token1] (symbole), z tabeli "8 zweryfikowanych pul"
    const ONCHAIN_POOLS: { dex: string; pair: string; address: string; token0: string; token1: string }[] = [
      { dex: "uniswap-v2", pair: "WETH/USDC", address: "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc", token0: "usdc", token1: "weth" },
      { dex: "sushiswap", pair: "WETH/USDC", address: "0x397ff1542f962076d0bfe58ea045ffa2d347aca0", token0: "usdc", token1: "weth" },
      { dex: "uniswap-v2", pair: "WETH/USDT", address: "0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852", token0: "weth", token1: "usdt" },
      { dex: "sushiswap", pair: "WETH/USDT", address: "0x06da0fd433c1a5d7a4faa01111c044910a184553", token0: "weth", token1: "usdt" },
      { dex: "uniswap-v2", pair: "WETH/DAI", address: "0xa478c2975ab1ea89e8196811f51a7b7ade33eb11", token0: "dai", token1: "weth" },
      { dex: "sushiswap", pair: "WETH/DAI", address: "0xc3d03e4f041fd4cd388c549ee2a29a9e5075882f", token0: "dai", token1: "weth" },
      { dex: "uniswap-v2", pair: "WBTC/WETH", address: "0xbb2b8038a1640196fbe3e38816f3e67cba72d940", token0: "wbtc", token1: "weth" },
      { dex: "sushiswap", pair: "WBTC/WETH", address: "0xceff51756c56ceffca006cd410b03ffc46dd3a58", token0: "wbtc", token1: "weth" },
    ];

    it("5 tokenów: decimals w TOKENS zgodne z on-chain (WETH 18, USDC 6, USDT 6, DAI 18, WBTC 8)", () => {
      const bySymbol = Object.fromEntries(TOKENS.map((t) => [t.symbol.toLowerCase(), t]));
      for (const [symbol, decimals] of Object.entries(ONCHAIN_TOKENS)) {
        expect(bySymbol[symbol], `brak tokenu ${symbol} w TOKENS`).toBeDefined();
        expect(bySymbol[symbol]!.decimals).toBe(decimals);
      }
    });

    it("8 pul: adresy w POOLS zgodne z on-chain", () => {
      expect(ONCHAIN_POOLS).toHaveLength(8);
      for (const expected of ONCHAIN_POOLS) {
        const pool = POOLS.find((p) => p.dex === expected.dex && p.pair === expected.pair);
        expect(pool, `brak puli ${expected.dex} ${expected.pair} w POOLS`).toBeDefined();
        expect(pool!.address?.toLowerCase()).toBe(expected.address);
        expect(pool!.verified).toBe(true);
      }
    });

    it("8 pul: token0/token1 wynikające z sortowania adresów (konwencja seed.ts bez --verify) zgodne z on-chain", () => {
      const addrBySymbol = Object.fromEntries(TOKENS.map((t) => [t.symbol.toLowerCase(), t.address]));
      const pairBySymbol = Object.fromEntries(PAIRS.map((p) => [p.symbol, p]));
      for (const expected of ONCHAIN_POOLS) {
        const pair = pairBySymbol[expected.pair]!;
        const baseAddr = addrBySymbol[pair.base.toLowerCase()]!;
        const quoteAddr = addrBySymbol[pair.quote.toLowerCase()]!;
        const [token0] = [baseAddr, quoteAddr].sort((a, b) => (a < b ? -1 : 1));
        const token0Symbol = token0 === baseAddr ? pair.base.toLowerCase() : pair.quote.toLowerCase();
        expect(token0Symbol, `${expected.dex} ${expected.pair}: token0 obliczony vs on-chain`).toBe(expected.token0);
      }
    });

    it("4 okna: nazwy zgodne z przyjętą konwencją nazewnictwa", () => {
      expect(WINDOWS.map((w) => w.name)).toEqual(["2021-05 krach", "2021-11 ATH", "2022-05 Luna", "2022-11 FTX"]);
      expect(WINDOWS).toHaveLength(4);
    });
  });
});
