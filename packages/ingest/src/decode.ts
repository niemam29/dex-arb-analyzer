import { Interface, getAddress } from "ethers";
import type { RawLog } from "./rpc/types.js";
import { hexToNumber } from "./utils/hex.js";

export const PAIR_IFACE = new Interface([
  "event Sync(uint112 reserve0, uint112 reserve1)",
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
]);
export const TOPIC_SYNC = PAIR_IFACE.getEvent("Sync")!.topicHash;
export const TOPIC_SWAP = PAIR_IFACE.getEvent("Swap")!.topicHash;

export type DecodedEvent =
  | { kind: "sync"; block: number; logIndex: number; txHash: string; reserve0: bigint; reserve1: bigint }
  | {
      kind: "swap";
      block: number;
      logIndex: number;
      txHash: string;
      sender: string;
      to: string;
      amount0In: bigint;
      amount1In: bigint;
      amount0Out: bigint;
      amount1Out: bigint;
    };

export function decodeLog(log: RawLog): DecodedEvent | null {
  if (log.removed) return null;
  const base = { block: hexToNumber(log.blockNumber), logIndex: hexToNumber(log.logIndex), txHash: log.transactionHash };
  if (log.topics[0] === TOPIC_SYNC) {
    const a = PAIR_IFACE.decodeEventLog("Sync", log.data, log.topics);
    return { kind: "sync", ...base, reserve0: a.reserve0 as bigint, reserve1: a.reserve1 as bigint };
  }
  if (log.topics[0] === TOPIC_SWAP) {
    const a = PAIR_IFACE.decodeEventLog("Swap", log.data, log.topics);
    return {
      kind: "swap",
      ...base,
      // Adresy w bazie są małymi literami (char(42), konwencja repo — patrz docs/konwencje.md „Decyzje"):
      // Etap 4 (retrospekcja) łączy je case-sensitive z adresami puli/routera.
      sender: getAddress(a.sender as string).toLowerCase(),
      to: getAddress(a.to as string).toLowerCase(),
      amount0In: a.amount0In as bigint,
      amount1In: a.amount1In as bigint,
      amount0Out: a.amount0Out as bigint,
      amount1Out: a.amount1Out as bigint,
    };
  }
  return null;
}
