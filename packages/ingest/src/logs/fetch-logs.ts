// Pobieranie logów Sync/Swap puli dla zakresu bloków (eth_getLogs) z automatycznym
// dzieleniem zakresu na pół, gdy publiczny RPC odmawia zwrócenia zbyt dużego wyniku.
import { decodeLog, TOPIC_SWAP, TOPIC_SYNC, type DecodedEvent } from "../decode.js";
import { RpcError, type RpcRequest } from "../rpc/client.js";
import type { RawLog } from "../rpc/types.js";
import type { BlockRange } from "../utils/chunks.js";
import { hexToNumber } from "../utils/hex.js";

export interface RpcLike {
  call<T>(method: string, params: unknown[]): Promise<T>;
  batch<T>(reqs: RpcRequest[]): Promise<T[]>;
}

const toHex = (n: number) => "0x" + n.toString(16);
// Komunikaty publicznych RPC przy zbyt dużym zakresie/wyniku eth_getLogs różnią się treścią
// między dostawcami (limit wyników, limit rozmiaru odpowiedzi, limit bloków) — dopasowujemy
// szeroko, żeby złapać każdy z nich, i dzielimy zakres na pół zamiast się poddawać.
const SPLIT_RE = /limit|too many|response size|exceed|more than/i;

export async function fetchPoolLogs(rpc: RpcLike, poolAddress: string, range: BlockRange): Promise<DecodedEvent[]> {
  let logs: RawLog[];
  try {
    logs = await rpc.call<RawLog[]>("eth_getLogs", [{
      address: poolAddress, fromBlock: toHex(range.fromBlock), toBlock: toHex(range.toBlock), topics: [[TOPIC_SYNC, TOPIC_SWAP]],
    }]);
  } catch (e) {
    if (e instanceof RpcError && SPLIT_RE.test(e.message) && range.toBlock > range.fromBlock) {
      const mid = Math.floor((range.fromBlock + range.toBlock) / 2);
      const left = await fetchPoolLogs(rpc, poolAddress, { fromBlock: range.fromBlock, toBlock: mid });
      const right = await fetchPoolLogs(rpc, poolAddress, { fromBlock: mid + 1, toBlock: range.toBlock });
      return [...left, ...right];
    }
    throw e;
  }
  const out: DecodedEvent[] = [];
  const seen = new Set<string>();
  for (const log of logs) {
    // RPC (zwłaszcza publiczne, po rotacji) nie może podrzucić logów innej puli ani innego zakresu —
    // taki wiersz trafiłby do sync_events/swap_events pod cudzym pool_id/blokiem bez śladu.
    const blockNumber = hexToNumber(log.blockNumber);
    if (log.address.toLowerCase() !== poolAddress.toLowerCase() || blockNumber < range.fromBlock || blockNumber > range.toBlock) {
      throw new Error(`eth_getLogs: log spoza żądanego zakresu/adresu (adres ${log.address}, blok ${blockNumber}, żądano ${poolAddress} ${range.fromBlock}–${range.toBlock})`);
    }
    const ev = decodeLog(log);
    if (!ev) continue;
    // Niektóre publiczne RPC potrafią zwrócić ten sam log dwukrotnie (np. przy wewnętrznej
    // retransmisji odpowiedzi) — bez odfiltrowania duplikatu insertEvents/ON CONFLICT DO UPDATE
    // rzuciłby błędem Postgresa "cannot affect row a second time" przy wstawianiu w jednej partii.
    const key = `${ev.block}:${ev.logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  // Sortowanie rosnąco po (block, logIndex): kolejność logów z eth_getLogs nie jest gwarantowana
  // przy dzieleniu zakresu (lewa/prawa połowa łączone konkatenacją) ani między dostawcami RPC.
  out.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  return out;
}
