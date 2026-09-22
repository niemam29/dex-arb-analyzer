// Opcjonalny test integracyjny na PRAWDZIWYM eRPC — 100 bloków (12429200-12429299)
// puli Uniswap V2 WETH/USDC, porównane z pierwszym wierszem data/events.csv projektu (docs/konwencje.md).
// Uruchamia się TYLKO gdy RUN_LIVE_RPC=1 i RPC_URL ustawione (patrz packages/ingest/package.json
// "test:live"); domyślny `npm test` pozostaje w pełni offline (describe.skipIf(!LIVE)). Nie dotyka
// bazy — sprawdza jedynie RpcClient/resolveWindowBlocks/fetchPoolLogs/fetchBlocks.
import { beforeAll, describe, it, expect } from "vitest";
import { loadIngestEnv } from "../src/env.js";
import { RpcClient } from "../src/rpc/client.js";
import { resolveWindowBlocks } from "../src/blocks/find-block.js";
import { fetchPoolLogs } from "../src/logs/fetch-logs.js";
import { fetchBlocks } from "../src/blocks/fetch-blocks.js";

const LIVE = process.env.RUN_LIVE_RPC === "1" && Boolean(process.env.RPC_URL);
const UNI = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc";
// tx hash pierwszego wiersza data/events.csv (blok 12429200 — sync+swap w tej samej tx; CSV ma
// zapisane logIndex 132/133, ale realny eRPC dla tej tx zwraca 140/141 — patrz komentarz niżej).
const TX = "0x7a6f0482e2de7d67f3d93fae464bf10214dd945f2326d1cb1c318347c840ec8a";

describe.skipIf(!LIVE)("eRPC live (100 bloków)", () => {
  // loadIngestEnv()/RpcClient dopiero w beforeAll (nie w ciele describe): describe.skipIf nadal
  // WYKONUJE ciało funkcji przy zbieraniu testów, nawet gdy suite jest pomijane — gdyby RpcClient
  // powstawał tu bezpośrednio, `loadIngestEnv()` rzucałaby przy braku RPC_URL także wtedy, gdy
  // LIVE=false (np. zwykłe `npm test` bez .env), łamiąc offline-by-default. beforeAll dla
  // pomijanego describe się nie uruchamia, więc ten problem znika.
  let rpc: RpcClient;
  beforeAll(() => {
    rpc = new RpcClient({ urls: loadIngestEnv().rpcUrls });
  });

  it("początek okna maj 2021 = blok 12429199 (wg realnego timestampu, nie wg CSV)", async () => {
    // Zweryfikowano na eRPC 2026-08-26: blok 12429198 ma timestamp 2021-05-13T23:59:58Z (< okno),
    // blok 12429199 ma 2021-05-14T00:00:13Z (pierwszy >= 00:00:00 UTC) — więc resolveWindowBlocks
    // poprawnie zwraca 12429199. data/events.csv projektu zaczyna się od bloku 12429200, bo to
    // pierwszy blok w oknie z eventem Sync/Swap TEJ puli (12429199 nie ma żadnego) — CSV filtruje
    // po evencie, nie po samej granicy czasowej okna. Różne rzeczy, nie rozbieżność/błąd.
    const { fromBlock } = await resolveWindowBlocks(rpc, Date.UTC(2021, 4, 14) / 1000, Date.UTC(2021, 4, 14, 1) / 1000);
    expect(fromBlock).toBe(12_429_199);
  }, 60_000);

  it("logi i bloki 12429200-12429299 zgodne z CSV projektu", async () => {
    const events = await fetchPoolLogs(rpc, UNI, { fromBlock: 12_429_200, toBlock: 12_429_299 });
    expect(events.length).toBeGreaterThan(0);
    // Dopasowanie po txHash/rezerwach, NIE po logIndex: eRPC zwraca dla tego Sync logIndex=140,
    // a CSV projektu (pierwszy wiersz) ma zapisane logIndex=132 dla tego samego zdarzenia (ten
    // sam txHash, te same rezerwy) — potwierdza to już udokumentowaną w docs/konwencje.md niższą jakość
    // log_index w CSV (tam chodziło o nadpisania uint32 dla dużych wartości; tu mamy dowód, że
    // rozjazd log_index vs eRPC dotyczy też "normalnych" małych wartości, nie tylko przepełnień).
    const first = events.find((e) => e.block === 12_429_200 && e.kind === "sync" && e.txHash === TX);
    expect(first).toMatchObject({ kind: "sync", txHash: TX, reserve0: 163737114053377n, reserve1: 44004147832345236861057n });

    const numbers = [...new Set(events.map((e) => e.block))].sort((a, b) => a - b);
    const rows = await fetchBlocks(rpc, numbers, 4);
    expect(rows.map((r) => r.number)).toEqual(numbers);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.timestamp).toBeGreaterThan(rows[i - 1]!.timestamp);
    const b0 = rows.find((r) => r.number === 12_429_200)!;
    expect(b0.baseFee).toBeNull();
    expect(b0.gasPriceMedian !== null && b0.gasPriceMedian > 0n).toBe(true);
    expect(b0.txGasPrice.has(TX)).toBe(true);
    // 14.05.2021 00:00 UTC = 1 620 950 400 (unix s.) — blok 12429200 musi leżeć w oknie lub po nim.
    expect(b0.timestamp).toBeGreaterThanOrEqual(1_620_950_400);
  }, 120_000);
});
