/**
 * Pobieranie i parsowanie receiptów transakcji — czysta logika (`parseReceipt`)
 * + `fetchReceipts` wstrzykujący klienta RPC (testowalne bez sieci). Retry/backoff i rotację
 * URL-i realizuje `RpcClient` z `@dex-arb/ingest` — nie duplikujemy jej tutaj.
 *
 * `RpcLike`/`RpcRequest` to lokalne, strukturalne odpowiedniki `RpcClient`/`RpcRequest` z
 * `@dex-arb/ingest` (metoda `batch`) — `@dex-arb/analysis` celowo nie dodaje zależności od
 * `@dex-arb/ingest` tylko po ten jeden typ; prawdziwy `RpcClient` pasuje strukturalnie (job
 * weryfikacji dostaje go przez wstrzyknięcie z `@dex-arb/worker`, które już zależy od ingest).
 */
import { decodeTransferLogs, decodeWethNativeTransfers } from './profit.js';
import type { Receipt } from './types.js';

export interface RpcRequest {
  method: string;
  params: unknown[];
}

export interface RpcLike {
  batch<T>(reqs: RpcRequest[]): Promise<T[]>;
}

export interface RawReceipt {
  transactionHash: string;
  from: string;
  /** Kontrakt wywołany (`eth_getTransactionReceipt.to`) — `null`/brak tylko przy tworzeniu kontraktu. */
  to?: string | null;
  gasUsed: string;
  effectiveGasPrice?: string;
  gasPrice?: string;
  status: string;
  logs: { address: string; topics: string[]; data: string }[];
}

/** Rozmiar paczki `eth_getTransactionReceipt` w jednym wywołaniu `RpcClient.batch`. */
const RECEIPT_CHUNK = 20;

export function parseReceipt(raw: RawReceipt): Receipt {
  const price = raw.effectiveGasPrice ?? raw.gasPrice;
  if (!price) throw new Error(`receipt ${raw.transactionHash}: brak effectiveGasPrice/gasPrice`);
  const from = raw.from.toLowerCase();
  const to = raw.to ? raw.to.toLowerCase() : null;
  // Withdrawal/Deposit WETH (ADR 0004 — patrz `decodeWethNativeTransfers`
  // w profit.ts) dołączone do `transfers` jako syntetyczne wpisy, żeby unwrap/wrap bez logu
  // Transfer nie gubił się przy liczeniu netto beneficjenta.
  const native = decodeWethNativeTransfers(raw.logs, from, to);
  return {
    txHash: raw.transactionHash.toLowerCase(),
    from,
    to,
    gasUsed: BigInt(raw.gasUsed),
    effectiveGasPrice: BigInt(price),
    status: BigInt(raw.status) === 1n ? 1 : 0,
    transfers: [...decodeTransferLogs(raw.logs), ...native.transfers],
    nativeLeg: native.nativeLeg,
    // ADR 0003: adres + topic0 wszystkich logów, do `classifyRoute` (route.ts) —
    // dwupulowość tx nie wynika z `transfers`/`nativeLeg` (te widzą tylko Transfer/Withdrawal/
    // Deposit), tylko z obecności/adresu logów Swap (V2/V3).
    logs: raw.logs.map((l) => ({ address: l.address.toLowerCase(), topic0: (l.topics[0] ?? '').toLowerCase() })),
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/**
 * Pobiera receipty wielu tx naraz: deduplikuje hashe (ta sama tx bywa kandydatem dla kilku
 * sąsiednich okazji), dzieli na paczki po `RECEIPT_CHUNK` i wysyła je przez `rpc.batch` z
 * ograniczoną współbieżnością `concurrency`. Brak receiptu (RPC zwraca `null` — tx jeszcze
 * niezindeksowana przez node) traktujemy jako błąd przejściowy: rzucamy, żeby wywołujący job
 * weryfikacji skorzystał ze standardowego mechanizmu retry workera, zamiast cicho pomijać okazję.
 */
export async function fetchReceipts(rpc: RpcLike, txHashes: string[], concurrency: number): Promise<Map<string, Receipt>> {
  const uniq = [...new Set(txHashes)];
  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += RECEIPT_CHUNK) chunks.push(uniq.slice(i, i + RECEIPT_CHUNK));

  const out = new Map<string, Receipt>();
  const chunkResults = await mapLimit(chunks, concurrency, async (chunk) => {
    const raws = await rpc.batch<RawReceipt | null>(chunk.map((h) => ({ method: 'eth_getTransactionReceipt', params: [h] })));
    return chunk.map((h, i) => {
      const raw = raws[i];
      if (!raw) throw new Error(`brak receiptu dla tx ${h} (błąd przejściowy — job ponowi próbę)`);
      return [h, parseReceipt(raw)] as const;
    });
  });
  for (const pairs of chunkResults) for (const [h, r] of pairs) out.set(h, r);
  return out;
}
