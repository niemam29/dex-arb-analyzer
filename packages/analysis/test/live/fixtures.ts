// Fixture panelu na żywo: rezerwy obu pul WETH/USDC z bloku 12 488 033 (rzeczywiste, z archiwalnego
// eth_call) + wariant Sushiswap z sztucznym spreadem ~1 %, żeby testować kierunek/optymalną
// transakcję. Fałszywe RPC odpowiada na batch JSON-RPC jak `RpcClient.batch` (kolejność = kolejność
// żądań), rejestrując wszystkie żądania do asercji.
import type { LiveRpc, LiveRpcRequest } from "../../src/live/rpcTypes.js";
import type { LivePair } from "../../src/live/sample.js";

export const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
export const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
export const UNI_POOL = "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc";
export const SUSHI_POOL = "0x397ff1542f962076d0bfe58ea045ffa2d347aca0";

export const WETH_USDC_PAIR: LivePair = {
  id: 1,
  symbol: "WETH/USDC",
  tokenBase: WETH,
  tokenQuote: USDC,
  decBase: 18,
  decQuote: 6,
  baseSymbol: "WETH",
  quoteSymbol: "USDC",
  poolA: { address: UNI_POOL, token0: USDC, token1: WETH, dexName: "uniswap-v2", feeBps: 30 },
  poolB: { address: SUSHI_POOL, token0: USDC, token1: WETH, dexName: "sushiswap", feeBps: 30 },
};

export const BLOCK_12488033 = { number: 12488033, hex: "0xbe8d61", timestamp: 0x60a9c4c0 };
/** token0 = USDC (6 dec), token1 = WETH (18 dec). */
export const UNI_RESERVES_12488033 = { reserve0: 112928425898061n, reserve1: 49178419840355489216087n };
export const SUSHI_RESERVES_12488033 = { reserve0: 176509848293355n, reserve1: 76867655078067656955931n };
/** Sushiswap z USDC podniesionym do 178 300 000 → cena 2319,57 vs 2296,30 na Uniswapie (spread 1,0134 %). */
export const SUSHI_RESERVES_SPREAD_1PCT = { reserve0: 178300000000000n, reserve1: 76867655078067656955931n };

const word = (v: bigint | number): string => BigInt(v).toString(16).padStart(64, "0");

/** ABI-encoding wyniku `getReserves()`: 3 słowa 32-bajtowe (uint112, uint112, uint32). */
export function encodeReserves(reserve0: bigint, reserve1: bigint, blockTimestampLast: number): string {
  return "0x" + word(reserve0) + word(reserve1) + word(blockTimestampLast);
}

export interface FakeRpcOptions {
  block?: { number: number; timestamp: number; baseFeePerGas?: string | undefined };
  reserves: Record<string, { reserve0: bigint; reserve1: bigint }>;
  /** logi Swap zwracane przez eth_getLogs (adres małymi literami, blockNumber hex) */
  logs?: { address: string; blockNumber: string }[];
  /** gdy true, każdy batch z eth_call o tagu innym niż "latest" odrzucany jak eRPC bez archiwum */
  rejectArchiveCalls?: boolean;
  /** gdy true, każdy eth_call o tagu innym niż "latest" odrzucany błędem NIE-archiwalnym (np. zły parametr) — do testu, że sampleLive propaguje go zamiast robić fallback na `latest` */
  rejectNonArchiveCalls?: boolean;
}

export interface FakeRpc extends LiveRpc {
  calls: LiveRpcRequest[][];
}

export function makeFakeRpc(opts: FakeRpcOptions): FakeRpc {
  const block = opts.block ?? { number: BLOCK_12488033.number, timestamp: BLOCK_12488033.timestamp, baseFeePerGas: "0x2540be400" };
  const calls: LiveRpcRequest[][] = [];
  return {
    calls,
    async batch<T>(reqs: LiveRpcRequest[]): Promise<T[]> {
      calls.push(reqs);
      return reqs.map((r): unknown => {
        if (r.method === "eth_getBlockByNumber") {
          return {
            number: "0x" + block.number.toString(16),
            timestamp: "0x" + block.timestamp.toString(16),
            ...(block.baseFeePerGas !== undefined ? { baseFeePerGas: block.baseFeePerGas } : {}),
          };
        }
        if (r.method === "eth_call") {
          const [tx, tag] = r.params as [{ to: string; data: string }, string];
          if (opts.rejectArchiveCalls && tag !== "latest") throw new Error("RPC -32000: missing trie node (archive)");
          if (opts.rejectNonArchiveCalls && tag !== "latest") throw new Error("RPC -32602: invalid params");
          const res = opts.reserves[tx.to.toLowerCase()];
          if (!res) throw new Error(`fake rpc: brak rezerw dla ${tx.to}`);
          return encodeReserves(res.reserve0, res.reserve1, block.timestamp);
        }
        if (r.method === "eth_getLogs") return opts.logs ?? [];
        throw new Error(`fake rpc: nieobsługiwana metoda ${r.method}`);
      }) as T[];
    },
  };
}
