// Orkiestracja analizy pary w oknie: spina wczytanie wejść, odtworzenie stanów, wykrywanie
// okazji i ocenę modeli w jedno wywołanie używane zarówno przez CLI (`cli.ts`), jak i handler
// workera (`@dex-arb/worker`, zadanie `analyze:pair-window`). Kolejność: loadPairWindowInputs ->
// (para kwotowana w WETH: wczytaj referencyjny kurs ETH/USD z już przeanalizowanej pary
// referencyjnej tego okna) -> buildPairStates -> computeBlockStates -> writeBlockStates ->
// detectOpportunities+writeOpportunities -> ensureScoringModels -> dla każdego modelu
// scoreRows+writeModelScores -> log podsumowania.
import { and, asc, eq } from "drizzle-orm";
import { evaluateScores, type Label } from "@dex-arb/core";
import { schema, type Db } from "@dex-arb/db";
import { REFERENCE_PAIR_SYMBOL } from "@dex-arb/shared";
import { computeBlockStates } from "./analyzeWindow.js";
import { ensureIngestComplete, ensureScoringModels, writeBlockStates, writeModelScores, writeOpportunities } from "./db.js";
import { loadPairWindowInputs } from "./loadInputs.js";
import { labelDistribution, scoreRows } from "./modelScores.js";
import { detectOpportunities } from "./opportunities.js";
import { makeEthUsd, makeQuoteUsd } from "./quoteUsd.js";
import { buildPairStates } from "./reserveStates.js";
import { stepPrevious } from "./stepPrevious.js";

const { blockStates, pairs } = schema;

/** Symbol pary referencyjnej dla kursu ETH/USD — patrz `loadRefEthUsd`. Kanoniczna wartość w
 * `@dex-arb/shared` — wcześniej duplikowana osobno tutaj i w `worker/src/matrix/plan.ts`. */
const REF_PAIR_SYMBOL: string = REFERENCE_PAIR_SYMBOL;

export interface AnalyzeProgress {
  log(msg: string): Promise<void>;
  progress(fraction01: number): Promise<void>;
  /** Opcjonalny sygnał anulowania (worker, SIGINT/SIGTERM) — sprawdzany między krokami. */
  signal?: AbortSignal;
}

export interface AnalyzeResult {
  blocks: number;
  opportunities: number;
  labelDistribution: Record<string, Record<Label, number>>;
  baselineFeasiblePct: number;
  agreementMamdaniVsBaseline: { auc: number; f1: number };
}

const NOOP: AnalyzeProgress = { log: async () => {}, progress: async () => {} };

/** Sprawdzenie kooperacyjnego anulowania między krokami (konwencja handlerów etapu 1 — patrz ingest:pool-window). */
function checkAbort(p: AnalyzeProgress): void {
  if (p.signal?.aborted) throw new Error("Przerwano");
}

/**
 * Kurs ETH/USD referencyjnej pary WETH/USDC dla tego samego okna — reference = `block_states`
 * tej pary w danym oknie, potrzebny gdy analizowana para jest kwotowana w WETH (`makeQuoteUsd`)
 * albo gdy trzeba przeliczyć gaz na USD dla pary innej niż quote-stablecoin (`makeEthUsd`).
 * Wyszukiwanie „ostatni znany blok ≤ b" — patrz `stepPrevious` (wcześniej duplikowana ad hoc
 * bisekcja, wyodrębniona do współdzielonej, testowanej funkcji).
 *
 * Eksportowana: `createDrizzleVerifyRepo` w `verify/verify-job.ts` reużywa jej wprost zamiast
 * duplikować zapytanie — inaczej `verify:pair-window` zakładałby `quoteUsd=1`/`ethUsd=priceA`
 * dla KAŻDEJ pary, poprawne tylko dla quote-stablecoina.
 */
export async function loadRefEthUsd(db: Db, windowId: number): Promise<(block: number) => number> {
  const [ref] = await db.select({ id: pairs.id }).from(pairs).where(eq(pairs.symbol, REF_PAIR_SYMBOL));
  if (!ref) throw new Error(`Brak pary referencyjnej ${REF_PAIR_SYMBOL}`);
  const rows = await db
    .select({ block: blockStates.block, price: blockStates.priceA })
    .from(blockStates)
    .where(and(eq(blockStates.pairId, ref.id), eq(blockStates.windowId, windowId)))
    .orderBy(asc(blockStates.block));
  if (rows.length === 0) throw new Error(`Najpierw przeanalizuj ${REF_PAIR_SYMBOL} w tym oknie (kurs ETH/USD)`);
  return stepPrevious(rows.map((r) => r.block), rows.map((r) => r.price));
}

export async function analyzePairWindow(
  db: Db,
  params: { pairId: number; windowId: number },
  p: AnalyzeProgress = NOOP,
): Promise<AnalyzeResult> {
  const inputs = await loadPairWindowInputs(db, params.pairId, params.windowId);
  await p.log(`Para ${inputs.pair.symbol}, okno ${inputs.window.id}: ${inputs.syncs.length} Synców, ${inputs.gasSamples.length} bloków z gazem`);
  checkAbort(p);

  // Bramka kompletności ingestu (ADR 0001): analiza NIE MOŻE ruszyć, dopóki OBIE pule
  // (Uniswap V2 + Sushiswap) nie są w 100% zaingestowane dla tego okna — inaczej bloki bez
  // Synca (bo jeszcze nie zaingestowane, nie dlatego że rezerwy się nie zmieniły) cicho
  // dziedziczyłyby poprzedni stan jako "brak zmiany", zamiast zgłosić brak danych, co fałszywie
  // zaniżałoby spready/okazje. Sprawdzana PRZED jakimkolwiek zapisem (writeBlockStates itd.).
  await ensureIngestComplete(db, [inputs.poolA.poolId, inputs.poolB.poolId], {
    fromBlock: inputs.window.fromBlock,
    toBlock: inputs.window.toBlock,
  });
  checkAbort(p);

  // Referencja WETH/USDC wczytywana raz i współdzielona przez quoteUsd (wartości w USD) i
  // ethUsdAt (koszt gazu w USD) — obie potrzebują jej wyłącznie dla pary kwotowanej w WETH
  // (patrz `makeQuoteUsd`/`makeEthUsd`); dla quote-stablecoina referencja nie
  // jest ładowana wcale.
  const refEthUsd = inputs.pair.quoteSymbol === "WETH" ? await loadRefEthUsd(db, params.windowId) : undefined;
  const quoteUsd = makeQuoteUsd(inputs.pair.quoteSymbol, refEthUsd);
  const ethUsdAt = makeEthUsd(inputs.pair.quoteSymbol, inputs.pair.baseSymbol, refEthUsd);

  const pairSpec = {
    tokenBase: inputs.pair.tokenBase,
    tokenQuote: inputs.pair.tokenQuote,
    decBase: inputs.pair.decBase,
    decQuote: inputs.pair.decQuote,
  };
  const states = buildPairStates(inputs.syncs, inputs.poolA, inputs.poolB, pairSpec, inputs.window.toBlock);
  const rows = computeBlockStates(states, inputs, quoteUsd, ethUsdAt);
  await p.log(`Stany bloków: ${rows.length} (od ${rows[0]?.block} do ${rows.at(-1)?.block})`);
  await p.progress(0.1);
  checkAbort(p);
  const bounds = { pairId: params.pairId, windowId: params.windowId, fromBlock: inputs.window.fromBlock, toBlock: inputs.window.toBlock };
  await writeBlockStates(db, rows, bounds, async (done, total) => p.progress(0.1 + 0.5 * (done / total)));
  checkAbort(p);

  const opps = detectOpportunities(rows);
  await writeOpportunities(db, params.pairId, params.windowId, opps);
  await p.log(`Okazje (spread > 0,65 %): ${opps.length}`);
  await p.progress(0.7);
  checkAbort(p);

  const models = await ensureScoringModels(db);
  const dist: AnalyzeResult["labelDistribution"] = {};
  let mamdaniScores: number[] = [];
  for (const [i, m] of models.entries()) {
    checkAbort(p);
    const scored = scoreRows(rows, m);
    await writeModelScores(db, scored, async (done, total) => p.progress(0.7 + 0.3 * ((i + done / total) / models.length)));
    dist[m.kind] = labelDistribution(scored);
    if (m.kind === "mamdani") mamdaniScores = scored.map((s) => s.score);
    await p.log(`Model ${m.kind}: ` + Object.entries(dist[m.kind]!).map(([l, v]) => `${l} ${v.toFixed(2)} %`).join(", "));
  }

  const feasible = rows.map((r) => r.baselineFeasible);
  const ev = evaluateScores(mamdaniScores, mamdaniScores.map((s) => s >= 50), feasible);
  await p.log(`Mamdani vs baseline (pseudo-prawda): AUC ${ev.auc.toFixed(3)}, F1 ${ev.f1.toFixed(3)}`);
  await p.progress(1);

  return {
    blocks: rows.length,
    opportunities: opps.length,
    labelDistribution: dist,
    baselineFeasiblePct: rows.length ? (100 * feasible.filter(Boolean).length) / rows.length : 0,
    agreementMamdaniVsBaseline: { auc: ev.auc, f1: ev.f1 },
  };
}
