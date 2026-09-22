/**
 * Minimalny kontrakt RPC dla samplera panelu na żywo (spec §3): tylko `batch`, żeby
 * `RpcClient` z `@dex-arb/ingest` pasował strukturalnie, a testy podawały fałszywe RPC bez
 * zależności runtime od `@dex-arb/ingest` (jest tylko devDependency `analysis`).
 */
export interface LiveRpcRequest {
  method: string;
  params: unknown[];
}

export interface LiveRpc {
  batch<T>(reqs: LiveRpcRequest[]): Promise<T[]>;
}

export interface RawLiveBlock {
  number: string;
  timestamp: string;
  /** brak przed EIP-1559 (i w niektórych atrapach) — wtedy przyjmujemy 0 */
  baseFeePerGas?: string | undefined;
}

export interface RawLiveLog {
  address: string;
  blockNumber: string;
}

/** `getReserves()` — keccak256("getReserves()")[0..4]. */
export const GET_RESERVES_SELECTOR = "0x0902f1ac";

/**
 * Topic zdarzenia `Swap(address,uint256,uint256,uint256,uint256,address)` Uniswap V2 / Sushiswap —
 * jedno źródło prawdy (`verify/route.ts`, ta sama wartość co `TOPIC_SWAP` liczona przez ethers w
 * `@dex-arb/ingest/decode.ts`); re-eksportowany stąd, żeby sampler i `analysis/src/index.ts` nie
 * musiały znać wewnętrznej lokalizacji modułu `verify`.
 */
export { TOPIC_SWAP_V2 } from "../verify/route.js";

export const toHexBlock = (n: number): string => "0x" + n.toString(16);
export const hexToNumber = (h: string): number => Number(BigInt(h));

/**
 * Rozpoznaje błąd "brak archiwum" bez importu `RpcError` (`@dex-arb/ingest` jest tylko
 * devDependency `analysis` — instanceof wymagałby zależności runtime). Sprawdza strukturalnie
 * pole `code` (JSON-RPC -32000, kod używany m.in. przez eRPC dla "missing trie node") i treść
 * komunikatu — pokrywa też atrapy testowe, które nie niosą pola `code`.
 */
export function isArchiveError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const code = (e as { code?: unknown }).code;
  if (code === -32000) return true;
  return /missing trie node|archive|pruned|not available/i.test(e.message);
}

/** Dekoduje wynik `getReserves()`: 3 słowa po 32 bajty (reserve0 uint112, reserve1 uint112, blockTimestampLast uint32). */
export function decodeReserves(hex: string): { reserve0: bigint; reserve1: bigint; blockTimestampLast: number } {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length < 192) throw new Error(`getReserves: oczekiwano 96 bajtów, otrzymano ${h.length / 2}`);
  return {
    reserve0: BigInt("0x" + h.slice(0, 64)),
    reserve1: BigInt("0x" + h.slice(64, 128)),
    blockTimestampLast: Number(BigInt("0x" + h.slice(128, 192))),
  };
}
