// Wyznaczanie granic bloków okna czasowego przez binary search po timestampach bloków
// (bloki mają rosnące, choć nierównomierne timestampy, więc szukamy monotonicznej granicy).
import { hexToNumber } from "../utils/hex.js";
import type { RawBlock } from "../rpc/types.js";

export interface BlockTimestampSource {
  call<T>(method: string, params: unknown[]): Promise<T>;
}

const toHex = (n: number) => "0x" + n.toString(16);

async function blockTimestamp(rpc: BlockTimestampSource, n: number): Promise<number> {
  const b = await rpc.call<RawBlock | null>("eth_getBlockByNumber", [toHex(n), false]);
  if (!b) throw new Error(`Brak bloku ${n}`);
  return hexToNumber(b.timestamp);
}

/** Pierwszy numer bloku o timestamp >= targetTs (binary search). */
export async function findBlockByTime(
  rpc: BlockTimestampSource,
  targetTs: number,
  lo = 0,
  hi?: number,
): Promise<number> {
  if (hi === undefined) hi = hexToNumber(await rpc.call<string>("eth_blockNumber", []));
  const head = hi;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await blockTimestamp(rpc, mid)) < targetTs) lo = mid + 1;
    else hi = mid;
  }
  // `hi` (a więc i wynikowe `lo`) to górna granica przekazana przez wywołującego (domyślnie
  // ostatni znany blok — head) — pętla NIGDY jej nie weryfikuje, jedynie do niej zbiega.
  // Gdy targetTs leży za timestampem heada, binary search bez tej weryfikacji po cichu
  // zwróciłby head, łamiąc kontrakt „pierwszy blok o ts >= target” — więc sprawdzamy jawnie
  // i przy niespełnionym warunku failujemy zamiast zwracać ucięte/błędne okno.
  const ts = await blockTimestamp(rpc, lo);
  if (ts < targetTs) {
    throw new Error(`okno wykracza poza ostatni blok (head=${head}, ts=${ts})`);
  }
  return lo;
}

export interface ResolveWindowOptions {
  /** Oczekiwane granice (seed-data) — przy rozbieżności wołane `warn`, wynik z RPC zwracany bez zmian. */
  expected?: { fromBlock: number; toBlock: number };
  warn?: (msg: string) => void;
}

/** Bloki okna [fromTs, toTs): pierwszy blok >= fromTs, ostatni blok < toTs. */
export async function resolveWindowBlocks(
  rpc: BlockTimestampSource,
  fromTs: number,
  toTs: number,
  opts: ResolveWindowOptions = {},
): Promise<{ fromBlock: number; toBlock: number }> {
  // Head pobieramy raz i przekazujemy do obu wyszukiwań — unika to zbędnego drugiego
  // eth_blockNumber (i ewentualnej niespójności, gdyby głowa łańcucha przesunęła się między
  // wywołaniami).
  const head = hexToNumber(await rpc.call<string>("eth_blockNumber", []));
  const fromBlock = await findBlockByTime(rpc, fromTs, 0, head);
  const toBlock = (await findBlockByTime(rpc, toTs, fromBlock, head)) - 1;
  if (toBlock < fromBlock) throw new Error(`Puste okno: ${fromTs}..${toTs}`);
  const { expected, warn = console.warn } = opts;
  if (expected && (expected.fromBlock !== fromBlock || expected.toBlock !== toBlock)) {
    warn(
      `Okno ${fromTs}..${toTs}: bloki z RPC ${fromBlock}–${toBlock} różnią się od oczekiwanych ${expected.fromBlock}–${expected.toBlock} (seed-data.ts)`,
    );
  }
  return { fromBlock, toBlock };
}
