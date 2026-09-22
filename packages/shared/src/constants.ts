// Stałe współdzielone między pakietami — próg spreadu (@dex-arb/analysis) oraz
// enumy statusów/kierunku/etykiety używane przez DTO API (@dex-arb/api, @dex-arb/web).
// `@dex-arb/shared` celowo nie zależy od `@dex-arb/db` ani `@dex-arb/core` (graf zależności
// pakietów, patrz global-constraints), więc wartości enumów bazy danych (job_status,
// ingest_status, direction_kind, feasibility_label) oraz `LABELS` z `@dex-arb/core` (types.ts)
// są tu duplikowane jako literały — muszą pozostać zsynchronizowane ręcznie; zgodność sprawdzają
// testy w pakietach, które mogą zależeć zarówno od `@dex-arb/shared`, jak i od
// `@dex-arb/core`/`@dex-arb/db` (analysis/api), nie w samym `shared`.

/**
 * Próg spreadu [%], powyżej którego blok liczy się jako okazja arbitrażu — suma prowizji
 * 2×0,3 % obu wymian (ADR 0002). Kanoniczne miejsce: `@dex-arb/analysis`
 * `OPPORTUNITY_THRESHOLD_PCT` jest teraz aliasem tej stałej.
 */
export const SPREAD_THRESHOLD_PCT = 0.65;

/** Statusy zadania w kolejce — zgodne z `job_status` (packages/db/src/schema/jobs.ts). */
export const JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Statusy zakresu ingestu — zgodne z `ingest_status` (packages/db/src/schema/raw.ts). */
export const INGEST_RANGE_STATUSES = ["pending", "done", "failed"] as const;
export type IngestRangeStatus = (typeof INGEST_RANGE_STATUSES)[number];

/** Kierunek arbitrażu — zgodny z `direction_kind` (packages/db/src/schema/derived.ts). */
export const DIRECTION_KINDS = ["none", "a_to_b", "b_to_a"] as const;
export type DirectionKind = (typeof DIRECTION_KINDS)[number];

/**
 * Etykieta lingwistyczna wyjścia W modelu oceny (kolejność rosnącej wykonalności) — zgodna
 * z `feasibility_label` (packages/db/src/schema/derived.ts) i `LABELS` w `@dex-arb/core`
 * (types.ts).
 */
export const LABELS = ["niewykonalna", "ryzykowna", "wykonalna", "atrakcyjna"] as const;
export type Label = (typeof LABELS)[number];

/**
 * Symbol pary referencyjnej dla kursu ETH/USD — potrzebna zawsze, gdy analizowana para jest
 * kwotowana w WETH (`@dex-arb/analysis` `analyzePairWindow.ts`/`quoteUsd.ts`) albo gdy planer
 * macierzy dokłada ją do kolejki analizy jako pierwszą (`@dex-arb/worker`
 * `src/matrix/plan.ts`). Kanoniczne miejsce — wcześniej ta sama wartość była
 * zduplikowana osobno w obu pakietach.
 */
export const REFERENCE_PAIR_SYMBOL = "WETH/USDC";

/**
 * Panel „Na żywo".
 * Wartości domyślne zmiennych środowiskowych LIVE_* (czyta je `packages/api/src/live/env.ts`)
 * oraz stałe próbkowania współdzielone przez `@dex-arb/analysis` (sampler) i `@dex-arb/web`
 * (opis „próbka co 15 s", liczba wierszy tabeli ostatnich próbek).
 */
/** LIVE_POLL_MS — odstęp między próbkami [ms]. */
export const LIVE_POLL_MS_DEFAULT = 15_000;
/** LIVE_HISTORY — pojemność ring-buffera (240 próbek × 15 s ≈ 1 h). */
export const LIVE_HISTORY_DEFAULT = 240;
/** LIVE_MODELS_REFRESH_MS — co ile poller przeładowuje `scoring_models.params`. */
export const LIVE_MODELS_REFRESH_MS_DEFAULT = 300_000;
/** Priorytet dodawany do baseFeePerGas [gwei] — typowy dla transakcji arbitrażowej. */
export const LIVE_PRIORITY_GWEI = 2;
/** Liczba ostatnich bloków, po których liczona jest średnia swapów na blok (aktywność botów). */
export const LIVE_SWAP_LOOKBACK_BLOCKS = 20;
/** Minimalna liczba próbek w historii, od której M liczone jest z percentyli; wcześniej M = LIVE_M_NEUTRAL. */
export const LIVE_M_MIN_HISTORY = 10;
/** Wartość M (ryzyko MEV) przed zebraniem LIVE_M_MIN_HISTORY próbek — środek skali 0–100 (ani nisko, ani wysoko), żeby brak historii nie zaniżał ani nie zawyżał ocen modeli w pierwszych minutach działania pollera. */
export const LIVE_M_NEUTRAL = 50;
/** Timeout pojedynczego żądania HTTP do eRPC [ms]. */
export const LIVE_RPC_TIMEOUT_MS = 10_000;
/** Liczba wierszy tabeli „Ostatnie próbki" w widoku. */
export const LIVE_RECENT_ROWS = 20;
