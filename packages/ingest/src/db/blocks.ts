// Warstwa DB: upsert bloków (blocks) i uzupełnianie gas_price swapów z pobranych bloków.
import { schema, type Db } from "@dex-arb/db";
import { sql } from "drizzle-orm";

/** Limit parametrów Postgresa (65 535) — wstawki partiami po 1000 wierszy. */
const BATCH = 1000;

export interface BlockRow {
  number: number;
  /** unix timestamp bloku (sekundy) — konwertowany na Date przy zapisie do timestamptz. */
  timestamp: number;
  baseFee: bigint | null;
  gasPriceMedian: bigint | null;
  txCount: number;
  /** txHash → effective gas price (wszystkie tx bloku, nie tylko swapy puli). */
  txGasPrice: Map<string, bigint>;
}

/** Wstawia/aktualizuje wiersze blocks. ON CONFLICT (number) DO UPDATE — bezpieczne przy ponownym backfillu. */
export async function upsertBlocks(db: Db, rows: BlockRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    await db
      .insert(schema.blocks)
      .values(
        rows.slice(i, i + BATCH).map((b) => ({
          number: b.number,
          timestamp: new Date(b.timestamp * 1000),
          txCount: b.txCount,
          baseFee: b.baseFee?.toString() ?? null,
          gasPriceMedian: b.gasPriceMedian?.toString() ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: schema.blocks.number,
        set: {
          timestamp: sql`excluded.timestamp`,
          txCount: sql`excluded.tx_count`,
          baseFee: sql`excluded.base_fee`,
          gasPriceMedian: sql`excluded.gas_price_median`,
        },
      });
  }
}

/**
 * Ustawia swap_events.gas_price dla tx należących do pobranych bloków. txGasPrice zawiera WSZYSTKIE tx
 * bloku — UPDATE trafia tylko w te, które są swapami zapisanymi w bazie (JOIN po tx_hash+block).
 * IS DISTINCT FROM: ponowne uruchomienie na tych samych danych nie liczy się jako zmiana → zwraca 0.
 */
export async function updateSwapGasPrices(db: Db, rows: BlockRow[]): Promise<number> {
  const pairs: { block: number; txHash: string; gasPrice: bigint }[] = [];
  for (const b of rows) {
    for (const [txHash, gasPrice] of b.txGasPrice) pairs.push({ block: b.number, txHash, gasPrice });
  }
  if (pairs.length === 0) return 0;

  let updated = 0;
  for (let i = 0; i < pairs.length; i += BATCH) {
    const chunk = pairs.slice(i, i + BATCH);
    const values = sql.join(
      chunk.map((p) => sql`(${p.block}::bigint, ${p.txHash}::text, ${p.gasPrice.toString()}::numeric)`),
      sql`, `,
    );
    const res = await db.execute(sql`
      UPDATE swap_events s SET gas_price = v.gas_price
      FROM (VALUES ${values}) AS v(block, tx_hash, gas_price)
      WHERE s.block = v.block AND s.tx_hash = v.tx_hash AND s.gas_price IS DISTINCT FROM v.gas_price`);
    updated += res.count ?? 0;
  }
  return updated;
}
