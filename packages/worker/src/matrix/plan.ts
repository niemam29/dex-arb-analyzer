// Planer macierzy pary×okna: czysta funkcja, żadnego I/O — cały stan (pary,
// pule, okna, co już zrobione, co już w kolejce) jest wejściem. CLI
// `packages/worker/scripts/matrix.ts` zbiera ten stan z bazy (reużywając `loadCoverage`
// z `@dex-arb/db`, żeby nie duplikować SQL pokrycia) i woła `planMatrix`.
//
// Kolejność w oknie: wszystkie ingest:pool-window (dla wszystkich pul biorących udział w
// analizie tego okna) -> analyze:pair-window dla WETH/USDC (referencja ETH/USD dla pozostałych
// par) jako pierwsza -> analyze:pair-window dla pozostałych par -> verify:pair-window dla
// żądanych par. Okna idą chronologicznie (rosnąco wg from_block); okno z jeszcze
// nierozstrzygniętymi blokami (from_block/to_block = null — resolveWindowBlocks w
// @dex-arb/ingest uzupełnia je dopiero przy pierwszym ingest:pool-window, patrz
// packages/ingest/src/jobs/ingest-pool-window.ts) ląduje na końcu kolejności (chronologia
// nieznana), stabilnie wg id.
//
// Kanoniczna wartość w `@dex-arb/shared` — reużyta też przez
// `@dex-arb/analysis` (`analyzePairWindow.ts`), żeby nie duplikować symbolu pary referencyjnej
// w obu pakietach.
export { REFERENCE_PAIR_SYMBOL } from "@dex-arb/shared";
import { REFERENCE_PAIR_SYMBOL } from "@dex-arb/shared";

/** Referencyjna liczba bloków użyta do skalowania szacunku ingestu, gdy okno ma nierozstrzygnięte
 * bloki — zgodna z rzeczywistymi oknami projektu (89 137–90 000 bloków, zaokrąglone w górę),
 * poprzednio 80 000, zaniżone względem realnych okien. */
export const DEFAULT_WINDOW_BLOCKS = 90_000;

export type JobType = "ingest:pool-window" | "analyze:pair-window" | "verify:pair-window";

export interface PairInfo {
  id: number;
  symbol: string;
}
export interface PoolInfo {
  id: number;
  pairId: number;
  dexName: string;
}
export interface WindowInfo {
  id: number;
  name: string;
  /** null = jeszcze nierozstrzygnięte (patrz komentarz modułu). */
  fromBlock: number | null;
  toBlock: number | null;
}

export interface JobSpec {
  type: JobType;
  /** `boolean` dla `force` (`verify:pair-window` — patrz `PlanOptions.force`/schema `@dex-arb/shared`
   * `verifyPairWindowParams`); pozostałe pola (`pairId`/`windowId`/`poolId`)
   * zawsze `number`. */
  params: Record<string, number | boolean>;
  estMinutes: number;
}

/** Liczniki okazji/weryfikacji dla pary×okna. Liczone jednym `LEFT JOIN` w CLI (patrz
 * scripts/matrix.ts). Verify jest "done" gdy `analyzeDone && verified === opportunities` — patrz
 * `planMatrix` (sama równość liczników bez bramki `analyzeDone` fałszywie
 * oznaczałaby NIEZANALIZOWANE pary/okna jako "w pełni zweryfikowane", bo 0===0). Gdy analiza już
 * się odbyła i naprawdę nie znalazła okazji (opportunities=0), to TEŻ liczy się jako done — 0===0
 * po bramce `analyzeDone` poprawnie odróżnia "nie ma czego weryfikować" od "jeszcze nie
 * wiadomo". */
export interface VerifyCounts {
  opportunities: number;
  verified: number;
}

export interface MatrixState {
  pairs: PairInfo[];
  pools: PoolInfo[];
  windows: WindowInfo[];
  /** klucz `${poolId}:${windowId}` — ingest 100% done (wg ingest_ranges/coverage_pct). */
  ingestDone: Set<string>;
  /** klucz `${pairId}:${windowId}` — block_states istnieją (analyze już wykonane). */
  analyzeDone: Set<string>;
  /** klucz `${pairId}:${windowId}` — liczniki opportunities/verified dla reguły "verify done". */
  verifyCounts: Map<string, VerifyCounts>;
  /** klucze `jobKey(type, params)` zadań już queued/running w tabeli jobs — dedup niezależny od skipDone. */
  activeJobs: Set<string>;
}

export interface PlanOptions {
  /** filtr symboli par (--pairs); referencja WETH/USDC jest dodawana do analizy automatycznie,
   * gdy potrzebna jako źródło ceny ETH/USD dla innej żądanej pary, nawet jeśli nie jest w filtrze. */
  pairs?: string[];
  /** filtr nazw okien (--windows). */
  windows?: string[];
  /** domyślnie true: pomija ingest 100% done i verify z istniejącymi weryfikacjami. */
  skipDone?: boolean;
  /** true (--force): NIE pomija analyze, mimo że block_states już istnieją (reanaliza od nowa). */
  force?: boolean;
}

/** Klucz zadania niezależny od kolejności pól w `params` — do dedupu względem kolejki. Pole
 * `force` jest CELOWO pomijane: to modyfikator zachowania joba
 * (`verify:pair-window` z `force: true` reweryfikuje już zweryfikowane okazje — patrz
 * `planMatrix`), nie część jego tożsamości — bez tego pominięcia zadanie `{pairId, windowId}`
 * już aktywne w kolejce BEZ `force` nie dedupowałoby się z nowo planowanym `{pairId, windowId,
 * force: true}` dla tej samej pary/okna (i odwrotnie), więc ten sam logiczny job trafiałby do
 * kolejki dwukrotnie. */
export function jobKey(type: JobType, params: Record<string, number | boolean>): string {
  const identity = Object.fromEntries(Object.entries(params).filter(([k]) => k !== "force"));
  return `${type}:${JSON.stringify(identity, Object.keys(identity).sort())}`;
}

/** Klucz z wiersza tabeli `jobs` (`type` + `params` jako JSON z bazy) — TA SAMA tożsamość co
 * `jobKey()` (jedno źródło prawdy). Regresja po 4db7a4d: CLI `scripts/matrix.ts` liczyło klucz
 * inline Z polem `force`, więc aktywny `verify:pair-window {force: true}` (rutynowy — web
 * "Weryfikuj" zawsze wysyła force) nie dedupował się z planowanym `{pairId, windowId}` i był
 * kolejkowany ponownie. Czysta funkcja, testowalna bez bazy. */
export function jobKeyFromRow(row: { type: string; params: unknown }): string {
  const params = (row.params ?? {}) as Record<string, number | boolean>;
  return jobKey(row.type as JobType, params);
}

/** Szacunek czasu (minuty). Ingest skaluje się liniowo z liczbą bloków okna (12,5 min przy
 * DEFAULT_WINDOW_BLOCKS, przy współbieżności 4 — na podstawie
 * obserwowanego czasu rzeczywistych zadań ingest:pool-window: 9–18 min, poprzednia stała 25 min
 * była zawyżona ~2×); `blocks=null` (okno jeszcze nierozstrzygnięte) używa DEFAULT_WINDOW_BLOCKS
 * jako przybliżenia. Analyze i verify są płaskie (~10 s / ~2 min) — nie skalują się z liczbą
 * bloków. */
export function estimateMinutes(type: JobType, blocks: number | null): number {
  if (type === "ingest:pool-window") {
    const b = blocks ?? DEFAULT_WINDOW_BLOCKS;
    return 12.5 * (b / DEFAULT_WINDOW_BLOCKS);
  }
  if (type === "analyze:pair-window") return 10 / 60;
  return 2; // verify:pair-window
}

function windowBlocks(w: WindowInfo): number | null {
  return w.fromBlock != null && w.toBlock != null ? w.toBlock - w.fromBlock + 1 : null;
}

export function planMatrix(state: MatrixState, opts: PlanOptions = {}): JobSpec[] {
  const skipDone = opts.skipDone ?? true;

  const windows = state.windows
    .filter((w) => !opts.windows || opts.windows.includes(w.name))
    .slice()
    .sort((a, b) => {
      const ba = windowBlocks(a);
      const bb = windowBlocks(b);
      if (ba == null && bb == null) return a.id - b.id;
      if (ba == null) return 1; // nierozstrzygnięte na koniec
      if (bb == null) return -1;
      return (a.fromBlock as number) - (b.fromBlock as number) || a.id - b.id;
    });

  const wantedPairs = state.pairs.filter((p) => !opts.pairs || opts.pairs.includes(p.symbol));
  const ref = state.pairs.find((p) => p.symbol === REFERENCE_PAIR_SYMBOL);
  // Referencja dokładana TYLKO gdy naprawdę jest potrzebna jako źródło kursu ETH/USD — czyli gdy
  // co najmniej jedna żądana para jest kwotowana w WETH (symbol kończy się "/WETH", np.
  // WBTC/WETH; patrz `makeQuoteUsd`/`makeEthUsd` w `@dex-arb/analysis`). Poprzednio
  // referencja była dokładana zawsze, gdy nie była już w `wantedPairs` — więc np.
  // `--pairs WETH/USDT` (quote-stablecoin, referencji NIE potrzebuje) i tak dokładał
  // WETH/USDC do kolejki analizy bez realnej potrzeby.
  const needsRef =
    ref !== undefined &&
    !wantedPairs.some((p) => p.id === ref.id) &&
    wantedPairs.some((p) => p.symbol.endsWith("/WETH"));
  const analyzePairs = needsRef ? [ref!, ...wantedPairs] : wantedPairs;
  const ordered = [...analyzePairs].sort((a, b) => {
    if (a.symbol === REFERENCE_PAIR_SYMBOL) return -1;
    if (b.symbol === REFERENCE_PAIR_SYMBOL) return 1;
    return a.id - b.id;
  });

  const poolsByPair = new Map<number, PoolInfo[]>();
  for (const pool of state.pools) {
    const list = poolsByPair.get(pool.pairId) ?? [];
    list.push(pool);
    poolsByPair.set(pool.pairId, list);
  }
  for (const list of poolsByPair.values()) list.sort((a, b) => a.id - b.id);

  const out: JobSpec[] = [];
  const push = (type: JobType, params: Record<string, number | boolean>, blocks: number | null, done: boolean): void => {
    if (state.activeJobs.has(jobKey(type, params))) return;
    if (skipDone && done) return;
    out.push({ type, params, estMinutes: estimateMinutes(type, blocks) });
  };

  for (const w of windows) {
    const blocks = windowBlocks(w);

    for (const p of ordered) {
      for (const pool of poolsByPair.get(p.id) ?? []) {
        push("ingest:pool-window", { poolId: pool.id, windowId: w.id }, blocks, state.ingestDone.has(`${pool.id}:${w.id}`));
      }
    }
    for (const p of ordered) {
      const done = !opts.force && state.analyzeDone.has(`${p.id}:${w.id}`);
      push("analyze:pair-window", { pairId: p.id, windowId: w.id }, blocks, done);
    }
    for (const p of wantedPairs) {
      const key = `${p.id}:${w.id}`;
      const vc = state.verifyCounts.get(key) ?? { opportunities: 0, verified: 0 };
      // Gdy para/okno NIE jest jeszcze przeanalizowana (albo --force wymusza reanalizę w tym
      // przebiegu), verify NIE jest "done" niezależnie od liczników — musi polecieć zaraz po
      // analyze (verify na 0 okazji to tani no-op, ale bez tej bramki 0===0 fałszywie
      // "kończyłoby" weryfikację par/okien, których jeszcze nikt nie analizował).
      const analyzed = !opts.force && state.analyzeDone.has(key);
      const done = analyzed && vc.verified === vc.opportunities;
      // `--force` przekazywane dalej DO PARAMETRÓW zadania (nie tylko do bramki `done` powyżej):
      // bez tego worker uruchamiałby `verify:pair-window` bez własnego
      // `force`, więc job sam pomijał już zweryfikowane okazje (`skipVerified` domyślnie true w
      // handlerze — `@dex-arb/shared` `verifyPairWindowParams`) i reweryfikacja przez `--force`
      // planera była pozorna. Pole dodawane TYLKO gdy `true` — nie zmienia `jobKey` istniejących,
      // niesforsowanych zadań w kolejce.
      const verifyParams: Record<string, number | boolean> = opts.force ? { pairId: p.id, windowId: w.id, force: true } : { pairId: p.id, windowId: w.id };
      push("verify:pair-window", verifyParams, blocks, done);
    }
  }

  return out;
}
