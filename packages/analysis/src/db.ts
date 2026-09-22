// Jedyny moduł z SQL-em dla wyników analizy: block_states, opportunities, scoring_models,
// model_scores — jedno źródło prawdy „co jest okazją" i jak zapisujemy wyniki modeli.
// `opportunities.ts`/`modelScores.ts` trzymają wyłącznie logikę czystą (bez dostępu do bazy).
import { and, eq, gt, inArray, lt, notExists, notInArray, or, sql } from "drizzle-orm";
import { loadPoolDoneBlocks, schema, type Db } from "@dex-arb/db";
import {
  BaselineModel, DEFAULT_BASELINE_PARAMS, DEFAULT_MAMDANI_PARAMS, MamdaniModel, parseBaselineParams,
  type Label, type ScoringModel,
} from "@dex-arb/core";
import type { BlockStateRow } from "./analyzeWindow.js";
import type { OpportunityRow } from "./opportunities.js";

// @dex-arb/db eksportuje tabele wyłącznie przez namespace `schema` (nie jako flat named
// exports), patrz packages/db/src/index.ts.
const { blockStates, opportunities, scoringModels, modelScores } = schema;

/** Batch dla insertów wsadowych — ≤1000 wierszy naraz. */
const BATCH = 1000;

/**
 * Kierunek arbitrażu: `arbitrage()` (core) i `BlockStateRow.direction` używają strzałek
 * ("a->b"/"b->a"/"none"), a enum bazy `direction_kind` (migracja 0002) — podkreślników
 * ("a_to_b"/"b_to_a"/"none"), bo Postgres nie pozwala na "->" w nazwie wartości enuma bez
 * cudzysłowu, a wolimy identyfikatory bez znaków specjalnych w SQL. Mapowanie jest jawne
 * i wyłącznie na granicy zapisu do bazy — `core` się nie zmienia. Rzuca przy nieznanej
 * wartości, żeby nie zapisać cichej wartości domyślnej.
 */
export type DbDirection = "none" | "a_to_b" | "b_to_a";
export function toDbDirection(d: "a->b" | "b->a" | "none"): DbDirection {
  switch (d) {
    case "none":
      return "none";
    case "a->b":
      return "a_to_b";
    case "b->a":
      return "b_to_a";
    default: {
      const exhaustive: never = d;
      throw new Error(`toDbDirection: nieznana wartość kierunku „${String(exhaustive)}"`);
    }
  }
}

// ---------------------------------------------------------------------------------------
// bramka kompletności ingestu (ADR 0001: "analyze gate on ingest completeness")
// ---------------------------------------------------------------------------------------

export interface PoolIngestCoverage {
  poolId: number;
  dexName: string;
  doneBlocks: number;
  totalBlocks: number;
}

/** Pokrycie ingestu `done` (unia przedziałów) dla pul w jednym oknie — SQL wspólne z `GET /coverage` w `@dex-arb/db` `queries/coverage.ts`. */
export async function loadPoolIngestCoverage(
  db: Db,
  poolIds: number[],
  window: { fromBlock: number; toBlock: number },
): Promise<PoolIngestCoverage[]> {
  const poolRows = await db
    .select({ id: schema.pools.id, dexName: schema.dexes.name })
    .from(schema.pools)
    .innerJoin(schema.dexes, eq(schema.dexes.id, schema.pools.dexId))
    .where(inArray(schema.pools.id, poolIds));

  const done = await loadPoolDoneBlocks(db, poolIds, window);

  const totalBlocks = window.toBlock - window.fromBlock + 1;
  return poolRows.map((p) => ({ poolId: p.id, dexName: p.dexName, doneBlocks: done.get(p.id) ?? 0, totalBlocks }));
}

/**
 * Bramka: analiza pary NIE MOŻE ruszyć, dopóki OBIE pule (Uniswap V2 + Sushiswap) nie są w 100%
 * zaingestowane dla całego okna — inaczej bloki bez Synca (bo jeszcze niezaingestowane) cicho
 * dziedziczyłyby poprzedni stan rezerw jako "brak zmiany", zamiast zgłosić brakujące dane, co
 * fałszywie zaniżałoby spready/okazje. Wołana z `analyzePairWindow` PRZED jakimkolwiek zapisem.
 * Rzuca po polsku z listą pokrycia KAŻDEJ puli (nie tylko pierwszej niekompletnej), żeby od razu
 * było wiadomo, ile brakuje i po której stronie.
 */
export async function ensureIngestComplete(
  db: Db,
  poolIds: number[],
  window: { fromBlock: number; toBlock: number },
): Promise<void> {
  const coverage = await loadPoolIngestCoverage(db, poolIds, window);
  const incomplete = coverage.filter((c) => c.doneBlocks < c.totalBlocks);
  if (incomplete.length === 0) return;
  const detail = coverage
    .map((c) => `${c.dexName} (pula ${c.poolId}): ${c.doneBlocks}/${c.totalBlocks} bloków (${c.totalBlocks > 0 ? ((100 * c.doneBlocks) / c.totalBlocks).toFixed(1) : "0.0"} %)`)
    .join(", ");
  throw new Error(`Nie można analizować — ingest niekompletny dla okna ${window.fromBlock}–${window.toBlock}: ${detail}`);
}

// ---------------------------------------------------------------------------------------
// block_states
// ---------------------------------------------------------------------------------------

/** Granice okna dla danej pary — do usuwania wierszy `block_states` spoza aktualnego zakresu. */
export interface BlockStatesBounds {
  pairId: number;
  windowId: number;
  fromBlock: number;
  toBlock: number;
}

/**
 * Upsert block_states (batch ≤1000, ON CONFLICT (pair_id, block) DO UPDATE — pełny wiersz) +
 * DELETE wierszy tej pary/okna spoza [bounds.fromBlock, bounds.toBlock] — po zawężeniu okna
 * (nowy `from_block`/`to_block` w `windows`) ponowny przebieg ma zbiegać do aktualnego zakresu,
 * a nie zostawiać osieroconych wierszy sprzed zawężenia (analogicznie do `writeOpportunities`).
 */
export async function writeBlockStates(
  db: Db,
  rows: BlockStateRow[],
  bounds: BlockStatesBounds,
  onProgress?: (done: number, total: number) => Promise<void>,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH).map((r) => ({
        pairId: r.pairId,
        windowId: r.windowId,
        block: r.block,
        priceA: r.priceA,
        priceB: r.priceB,
        spreadPct: r.spreadPct,
        tvlMinUsd: r.tvlMinUsd,
        gasPriceMedian: r.gasPriceMedian,
        swapsInBlock: r.swapsInBlock,
        s: r.s,
        g: r.g,
        l: r.l,
        m: r.m,
        optTradeUsd: r.optTradeUsd,
        baselineNetProfitUsd: r.baselineNetProfitUsd,
        baselineFeasible: r.baselineFeasible,
        direction: toDbDirection(r.direction),
        grossProfitUsd: r.grossProfitUsd,
      }));
      if (chunk.length === 0) continue;
      await tx
        .insert(blockStates)
        .values(chunk)
        .onConflictDoUpdate({
          target: [blockStates.pairId, blockStates.block],
          set: {
            windowId: sql`excluded.window_id`,
            priceA: sql`excluded.price_a`,
            priceB: sql`excluded.price_b`,
            spreadPct: sql`excluded.spread_pct`,
            tvlMinUsd: sql`excluded.tvl_min_usd`,
            gasPriceMedian: sql`excluded.gas_price_median`,
            swapsInBlock: sql`excluded.swaps_in_block`,
            s: sql`excluded.s`,
            g: sql`excluded.g`,
            l: sql`excluded.l`,
            m: sql`excluded.m`,
            optTradeUsd: sql`excluded.opt_trade_usd`,
            baselineNetProfitUsd: sql`excluded.baseline_net_profit_usd`,
            baselineFeasible: sql`excluded.baseline_feasible`,
            direction: sql`excluded.direction`,
            grossProfitUsd: sql`excluded.gross_profit_usd`,
          },
        });
      await onProgress?.(Math.min(i + BATCH, rows.length), rows.length);
    }
    await tx
      .delete(blockStates)
      .where(
        and(
          eq(blockStates.pairId, bounds.pairId),
          eq(blockStates.windowId, bounds.windowId),
          or(lt(blockStates.block, bounds.fromBlock), gt(blockStates.block, bounds.toBlock)),
        ),
      );
  });
}

// ---------------------------------------------------------------------------------------
// opportunities
// ---------------------------------------------------------------------------------------

/**
 * Upsert okazji (batch ≤1000, ON CONFLICT (pair_id, block) DO UPDATE) + DELETE okazji tego
 * pair/window, których blok nie jest już w `rows` (spread spadł poniżej progu przy ponownym
 * uruchomieniu) — dzięki temu ponowne przebiegi zbiegają do aktualnego stanu, a `id serial`
 * istniejących okazji NIE zmienia się (w przeciwieństwie do DELETE-all+INSERT).
 */
export async function writeOpportunities(
  db: Db,
  pairId: number,
  windowId: number,
  rows: OpportunityRow[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH).map((r) => ({
        pairId: r.pairId,
        windowId: r.windowId,
        block: r.block,
        spreadPct: r.spreadPct,
        direction: toDbDirection(r.direction),
        estProfitUsd: r.estProfitUsd,
      }));
      if (chunk.length === 0) continue;
      await tx
        .insert(opportunities)
        .values(chunk)
        .onConflictDoUpdate({
          target: [opportunities.pairId, opportunities.block],
          set: {
            windowId: sql`excluded.window_id`,
            spreadPct: sql`excluded.spread_pct`,
            direction: sql`excluded.direction`,
            estProfitUsd: sql`excluded.est_profit_usd`,
          },
        });
    }
    const keep = and(eq(opportunities.pairId, pairId), eq(opportunities.windowId, windowId));
    const blocks = rows.map((r) => r.block);
    await tx.delete(opportunities).where(blocks.length > 0 ? and(keep, notInArray(opportunities.block, blocks)) : keep);
  });
}

// ---------------------------------------------------------------------------------------
// scoring_models / model_scores
// ---------------------------------------------------------------------------------------

export interface ModelEntry {
  id: number;
  kind: "baseline" | "mamdani";
  model: ScoringModel;
}

export interface ModelScoreRow {
  modelId: number;
  pairId: number;
  block: number;
  score: number;
  label: Label;
}

/**
 * Wersja modeli utrzymywanych bezpośrednio tutaj: baseline v1, mamdani v1 (ANFIS ma osobny cykl życia w `worker`).
 * `params` tutaj to DEFINICJA wersji 1 — `ensureScoringModels` odświeża nimi wiersz bazy
 * przy każdym uruchomieniu, więc `scoring_models.params` dla tych dwóch wpisów zawsze
 * zbiega do wartości z kodu (nie da się ich potrwale nadpisać ręcznie w bazie).
 */
const MODEL_DEFS = [
  { name: "baseline", kind: "baseline" as const, version: 1, params: DEFAULT_BASELINE_PARAMS },
  { name: "mamdani", kind: "mamdani" as const, version: 1, params: DEFAULT_MAMDANI_PARAMS },
];

/**
 * Zapewnia wiersze `baseline` v1 i `mamdani` v1 w scoring_models (idempotentnie, upsert po
 * UNIQUE (name, version) — migracja 0002; przy konflikcie odświeża `params` do definicji z
 * kodu, patrz `MODEL_DEFS`) i buduje model RAZ na wpis z tego, co faktycznie wróciło z bazy
 * (`row.params`, nie `d.params`) — `scoring_models.params` jest źródłem prawdy dla budowy
 * modelu, tak jak dla przyszłych wersji (ANFIS, warianty Mamdaniego) trenowanych poza tym
 * upsertem. Model budowany raz na wpis: ocena 77k wierszy nie może budować silnika
 * Mamdaniego per wiersz.
 */
export async function ensureScoringModels(db: Db): Promise<ModelEntry[]> {
  const out: ModelEntry[] = [];
  for (const d of MODEL_DEFS) {
    const [row] = await db
      .insert(scoringModels)
      .values({ name: d.name, kind: d.kind, version: d.version, params: d.params, trainedOnWindowIds: [], metrics: {} })
      .onConflictDoUpdate({
        target: [scoringModels.name, scoringModels.version],
        set: { name: sql`excluded.name`, params: sql`excluded.params` },
      })
      .returning({ id: scoringModels.id, name: scoringModels.name, params: scoringModels.params });
    const model: ScoringModel =
      d.kind === "mamdani" ? new MamdaniModel(row!.params) : new BaselineModel(parseBaselineParams(row!.params));
    out.push({ id: row!.id, kind: d.kind, model });
  }
  return out;
}

/**
 * Upsert model_scores (batch ≤1000, ON CONFLICT (model_id, pair_id, block) DO UPDATE) + DELETE
 * wierszy dla każdej pary (model_id, pair_id) obecnej w `rows`, których blok nie ma już wiersza
 * w `block_states` dla tej pary — po zawężeniu okna `writeBlockStates` usuwa osierocone bloki z
 * `block_states`, a to sprząta odpowiadające im wyniki modeli, żeby oba zbiegały do tego samego
 * zakresu bloków.
 */
export async function writeModelScores(
  db: Db,
  rows: ModelScoreRow[],
  onProgress?: (done: number, total: number) => Promise<void>,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      if (chunk.length === 0) continue;
      await tx
        .insert(modelScores)
        .values(chunk)
        .onConflictDoUpdate({
          target: [modelScores.modelId, modelScores.pairId, modelScores.block],
          set: { score: sql`excluded.score`, label: sql`excluded.label` },
        });
      await onProgress?.(Math.min(i + BATCH, rows.length), rows.length);
    }

    const modelPairKeys = new Map(rows.map((r) => [`${r.modelId}:${r.pairId}`, { modelId: r.modelId, pairId: r.pairId }]));
    for (const { modelId, pairId } of modelPairKeys.values()) {
      await tx
        .delete(modelScores)
        .where(
          and(
            eq(modelScores.modelId, modelId),
            eq(modelScores.pairId, pairId),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(blockStates)
                .where(and(eq(blockStates.pairId, modelScores.pairId), eq(blockStates.block, modelScores.block))),
            ),
          ),
        );
    }
  });
}
