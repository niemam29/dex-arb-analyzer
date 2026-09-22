// Handler zadania import:csv (spec §4a): jednorazowy import historycznych zdarzeń
// Sync/Swap z zewnętrznego pliku events.csv — poprzedza właściwy ingest RPC dla
// okna 14–26 maja 2021, bo dane zostały już raz pobrane i zweryfikowane w tamtym projekcie.
//
// CSV: blockNumber,logIndex,pool,type,txHash,reserve0,reserve1,price,volumeUsd
// - sync: reserve0/reserve1 wypełnione, price/volumeUsd (pochodne) ignorowane.
// - swap: reserve0/reserve1/price puste, volumeUsd (pochodna) ignorowana; sender/to/kwoty/gas_price
//   uzupełnia dopiero backfill w ingest:pool-window, tu wstawiane jako NULL.
// - `pool` (uniswap/sushiswap) mapowany na id puli przez params.poolAliases.
// - ok. 12 004 wierszy ma logIndex uszkodzony przepełnieniem uint32 przy eksporcie z projektu
//   źródłowego (wartości ~4 294 967 29x zamiast małych indeksów w bloku, podczas gdy prawdziwy
//   logIndex w bloku nigdy nie przekracza ~1200). Decyzja projektowa (ADR 0001): NIE zachowujemy
//   tych wierszy (nie poszerzamy log_index do bigint) — po docelowym re-ingest RPC te same bloki
//   dadzą POPRAWNY logIndex i uszkodzone wiersze z CSV nie skolidowałyby z nim kluczem głównym,
//   więc zdublowałyby zdarzenia w bloku. Zamiast tego: wiersze z uszkodzonym logIndex są
//   POMIJANE (nie wstawiane), zliczane i zgłaszane jednym ostrzeżeniem. Re-ingest RPC (ta sama
//   para/okno) jest źródłem autorytatywnym.
// - niezależnie od powyższego: część "sensownych" wierszy (logIndex ≤ 1 000 000) też koliduje
//   kluczem głównym (pool_id, block, log_index) z innym wierszem tego samego typu w tym samym
//   bloku (usterka eksportera źródłowego, różne txHash/rezerwy) — te są odrzucane przez
//   ON CONFLICT DO NOTHING; różnica między liczbą "podjętych prób" a faktycznie wstawionych jest
//   liczona i logowana osobno.
import * as fs from "node:fs";
import * as readline from "node:readline";
import { schema, type Db } from "@dex-arb/db";
import { inArray } from "drizzle-orm";
import type { ImportCsvParams, JobHandler } from "@dex-arb/shared";

const EXPECTED_HEADER = "blockNumber,logIndex,pool,type,txHash,reserve0,reserve1,price,volumeUsd";
/** Limit parametrów Postgresa — wstawki partiami (spójne z db/events.ts). */
const BATCH = 1000;
/** Co ile linii raportować postęp/log (plik ma ~280 000 linii). */
const PROGRESS_EVERY_LINES = 20_000;
/**
 * Próg "sensownego" logIndex w obrębie bloku — prawdziwe wartości w danych źródłowych nie
 * przekraczają ~1200 (blok ma najwyżej kilkaset zdarzeń), uszkodzone (przepełnienie uint32)
 * zaczynają się od ~4 294 967 137, więc próg 1 000 000 rozdziela je z dużym marginesem.
 */
const CORRUPTED_LOG_INDEX_THRESHOLD = 1_000_000;

function isCorruptedLogIndex(logIndex: number): boolean {
  return !Number.isFinite(logIndex) || !Number.isInteger(logIndex) || logIndex > CORRUPTED_LOG_INDEX_THRESHOLD;
}

export type ParsedEventRow =
  | { kind: "sync"; poolId: number; block: number; logIndex: number; txHash: string; reserve0: string; reserve1: string; corrupted: boolean }
  | { kind: "swap"; poolId: number; block: number; logIndex: number; txHash: string; corrupted: boolean };

/** Parsuje pojedynczy wiersz danych CSV (bez nagłówka) na strukturę do wstawienia. Rzuca przy nieznanej puli/typie — komunikat zawiera numer linii (1-based, licząc nagłówek). */
export function parseEventLine(line: string, lineNo: number, poolAliases: Record<string, number>): ParsedEventRow {
  const [blockNumber, logIndexStr, pool, type, txHash, reserve0, reserve1] = line.split(",");
  const poolId = poolAliases[pool ?? ""];
  if (poolId === undefined) {
    throw new Error(`linia ${lineNo}: nieznana pula "${pool ?? ""}" (dostępne aliasy: ${Object.keys(poolAliases).join(", ")})`);
  }
  const logIndex = Number(logIndexStr);
  const corrupted = isCorruptedLogIndex(logIndex);
  const base = { poolId, block: Number(blockNumber), logIndex, txHash: txHash ?? "", corrupted };
  if (type === "sync") return { kind: "sync", ...base, reserve0: reserve0 ?? "", reserve1: reserve1 ?? "" };
  if (type === "swap") return { kind: "swap", ...base };
  throw new Error(`linia ${lineNo}: nieznany typ zdarzenia "${type}"`);
}

export function makeImportCsv({ db }: { db: Db }): JobHandler<ImportCsvParams> {
  return async ({ path: csvPath, poolAliases }, ctx) => {
    if (!fs.existsSync(csvPath)) throw new Error(`Brak pliku CSV: ${csvPath}`);

    // Zabezpieczenie: CSV i RPC nigdy nie mogą mieszać danych dla tej
    // samej puli — obecność choćby jednego wiersza w ingest_ranges dla puli oznacza, że ingest:pool-window
    // już dla niej działał (albo działa), więc import CSV danych historycznych byłby niespójny
    // (inne/niepełne dane, ryzyko duplikatów logicznych przy różnym pochodzeniu log_index).
    const poolIds = [...new Set(Object.values(poolAliases))];
    if (poolIds.length > 0) {
      const existing = await db
        .select({ poolId: schema.ingestRanges.poolId })
        .from(schema.ingestRanges)
        .where(inArray(schema.ingestRanges.poolId, poolIds));
      if (existing.length > 0) {
        const bad = [...new Set(existing.map((r) => r.poolId))];
        throw new Error(
          `Import CSV zablokowany: pula(e) id=${bad.join(", ")} ma już zakresy w ingest_ranges (dane z RPC). ` +
            `CSV nie może być mieszany z danymi z ingest:pool-window dla tej samej puli — import:csv jest ` +
            `testem parytetu do puszczania wyłącznie na osobnej/testowej bazie, nigdy na puli docelowo zasilanej z RPC.`,
        );
      }
    }

    const total = fs.statSync(csvPath).size;
    const stream = fs.createReadStream(csvPath);
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let syncBatch: Extract<ParsedEventRow, { kind: "sync" }>[] = [];
    let swapBatch: Extract<ParsedEventRow, { kind: "swap" }>[] = [];
    let lineNo = 0;
    // "Attempted"/"inserted" rozróżniamy, żeby policzyć, ile wierszy odrzucił ON CONFLICT
    // (kolizja klucza głównego wśród wierszy z sensownym logIndex) — nie da się tego wywnioskować
    // z samej liczby linii CSV.
    let nSyncAttempted = 0;
    let nSwapAttempted = 0;
    let nSyncInserted = 0;
    let nSwapInserted = 0;
    let nCorrupted = 0;

    const flush = async () => {
      if (syncBatch.length) {
        const inserted = await db
          .insert(schema.syncEvents)
          .values(syncBatch.map((r) => ({ poolId: r.poolId, block: r.block, logIndex: r.logIndex, txHash: r.txHash, reserve0: r.reserve0, reserve1: r.reserve1 })))
          .onConflictDoNothing()
          .returning({ block: schema.syncEvents.block });
        nSyncAttempted += syncBatch.length;
        nSyncInserted += inserted.length;
        syncBatch = [];
      }
      if (swapBatch.length) {
        const inserted = await db
          .insert(schema.swapEvents)
          .values(swapBatch.map((r) => ({ poolId: r.poolId, block: r.block, logIndex: r.logIndex, txHash: r.txHash })))
          .onConflictDoNothing()
          .returning({ block: schema.swapEvents.block });
        nSwapAttempted += swapBatch.length;
        nSwapInserted += inserted.length;
        swapBatch = [];
      }
    };

    for await (const line of rl) {
      lineNo++;
      if (lineNo === 1) {
        if (line.trim() !== EXPECTED_HEADER) throw new Error(`Nieoczekiwany nagłówek CSV: "${line}"`);
        continue;
      }
      if (!line.trim()) continue;
      if (ctx.signal.aborted) throw new Error("Przerwano");

      const row = parseEventLine(line, lineNo, poolAliases);
      if (row.corrupted) {
        // Pomijamy — nie trafia do partii do wstawienia (ADR 0001: nie zachowujemy uszkodzonego
        // logIndex, autorytatywne dane da re-ingest RPC tego samego okna).
        nCorrupted++;
        continue;
      }
      if (row.kind === "sync") syncBatch.push(row);
      else swapBatch.push(row);

      if (syncBatch.length >= BATCH || swapBatch.length >= BATCH) await flush();

      if (lineNo % PROGRESS_EVERY_LINES === 0) {
        await ctx.progress(Math.min(0.99, stream.bytesRead / total));
        await ctx.log(`Import CSV: linia ${lineNo}, dotychczas ${nSyncInserted} sync, ${nSwapInserted} swap`);
      }
    }
    await flush();

    if (nCorrupted > 0) {
      await ctx.log(`pominięto ${nCorrupted} wierszy z uszkodzonym logIndex`);
    }
    const droppedSync = nSyncAttempted - nSyncInserted;
    const droppedSwap = nSwapAttempted - nSwapInserted;
    if (droppedSync > 0 || droppedSwap > 0) {
      await ctx.log(
        `Kolizje klucza głównego (ON CONFLICT DO NOTHING): oczekiwano ${nSyncAttempted} sync / ${nSwapAttempted} swap, ` +
          `wstawiono ${nSyncInserted} sync / ${nSwapInserted} swap (odrzucono ${droppedSync} sync, ${droppedSwap} swap).`,
      );
    }
    await ctx.log(`Import zakończony: ${nSyncInserted} sync + ${nSwapInserted} swap = ${nSyncInserted + nSwapInserted} wierszy (linii danych: ${lineNo - 1}).`);
    await ctx.progress(1);
  };
}
