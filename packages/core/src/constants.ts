/**
 * Stałe metodyki (jedno miejsce; jednostki i uzasadnienie w JSDoc). Wartości są IDENTYCZNE z
 * dotychczasowymi definicjami rozproszonymi po pakietach — ten moduł je tylko centralizuje;
 * `features.ts` i inne miejsca reeksportują stąd. `CONSTANT_TABLE` służy generatorowi
 * `results/constants.md` (skrypt `export-results`) i rozdziałowi „Metodyka" pracy.
 */

/** Gaz transakcji arbitrażowej dwupulowej (2 swapy + transfer) [jednostki gazu] — założenie baseline v1 i cechy G. */
export const ARB_GAS = 220_000;
/** Wartość referencyjna transakcji, względem której liczona jest cecha G [USD]. */
export const REF_TRADE_USD = 50_000;
/** Górne obcięcie cechy S (spread) [%]. */
export const S_MAX = 3;
/** Górne obcięcie cechy G (koszt gazu względem REF_TRADE_USD) [%]. */
export const G_MAX = 2;
/** Górne obcięcie cechy L (TVL płytszej puli) [mln USD]. */
export const L_MAX = 100;
/** Horyzont weryfikacji retrospektywnej: okazja z bloku B jest śledzona w B..B+K_MAX [bloki]. */
export const K_MAX = 3;
/** Próg spreadu, od którego blok jest okazją [%] — suma prowizji 2 × 0,3 % obu wymian V2. Duplikat literału w `@dex-arb/shared` (`SPREAD_THRESHOLD_PCT`, bez zależności od core); równość sprawdza `packages/analysis/test/constants-parity.test.ts`. */
export const SPREAD_THRESHOLD_PCT = 0.65;
/** Próg klasyfikacji binarnej na skali score 0–100 (środek symetryczny) — wspólny dla wszystkich modeli. */
export const SCORE_THRESHOLD = 50;
/** Priorytet dodawany do baseFeePerGas w panelu na żywo [gwei] — typowy dla tx arbitrażowej po EIP-1559. Duplikat w `@dex-arb/shared` (`LIVE_PRIORITY_GWEI`). */
export const LIVE_PRIORITY_GWEI = 2;
/** Maksymalna przerwa między kolejnymi okazjami tej samej pary tworząca jeden klaster (grupa podziału train/test) [bloki]. Duplikat w `@dex-arb/analysis` (`BLOCK_CLUSTER_GAP_MAX`). */
export const BLOCK_CLUSTER_GAP_MAX = 3;
/** Liczba wierszy tła (bloki bez okazji) na jeden pozytyw w zbiorze uczącym ANFIS [—]. Duplikat domyślnej wartości `negativesPerPositive` w `@dex-arb/analysis` `buildDataset`. */
export const NEGATIVES_PER_POSITIVE = 10;

export interface ConstantDef {
  name: string;
  value: number;
  unit: string;
  rationale: string;
  /** Gdzie stała jest użyta (ścieżka pliku) — do tabeli w pracy. */
  usedIn: string;
}

export const CONSTANT_TABLE: readonly ConstantDef[] = [
  { name: "ARB_GAS", value: ARB_GAS, unit: "gaz", rationale: "Typowy koszt 2 swapów V2 + transferu; założenie baseline v1 i cechy G (boty realnie ~153k, patrz ADR 0006).", usedIn: "packages/core/src/features.ts" },
  { name: "REF_TRADE_USD", value: REF_TRADE_USD, unit: "USD", rationale: "Wartość transakcji referencyjnej dla cechy G = koszt gazu / REF_TRADE_USD · 100 %.", usedIn: "packages/core/src/features.ts" },
  { name: "S_MAX", value: S_MAX, unit: "%", rationale: "Dziedzina zmiennej S w FIS; spready > 3 % obcinane.", usedIn: "packages/core/src/features.ts" },
  { name: "G_MAX", value: G_MAX, unit: "%", rationale: "Dziedzina zmiennej G w FIS.", usedIn: "packages/core/src/features.ts" },
  { name: "L_MAX", value: L_MAX, unit: "mln USD", rationale: "Dziedzina zmiennej L w FIS; dla WETH/USDC L = 100 w każdym bloku (pule zbyt głębokie).", usedIn: "packages/core/src/features.ts" },
  { name: "K_MAX", value: K_MAX, unit: "bloki", rationale: "Okno śledzenia konsumpcji okazji B..B+3 (ADR 0003).", usedIn: "packages/analysis/src/verify/classify.ts" },
  { name: "SPREAD_THRESHOLD_PCT", value: SPREAD_THRESHOLD_PCT, unit: "%", rationale: "Suma prowizji 2 × 0,3 %; poniżej tej rozbieżności arbitraż dwupulowy nie pokrywa opłat (ADR 0002).", usedIn: "packages/analysis/src/opportunities.ts" },
  { name: "SCORE_THRESHOLD", value: SCORE_THRESHOLD, unit: "score", rationale: "Środek skali 0–100; stały próg dla wszystkich modeli (asymetria kalibracji — ADR 0006).", usedIn: "packages/api/src/queries/evaluation.sql.ts" },
  { name: "LIVE_PRIORITY_GWEI", value: LIVE_PRIORITY_GWEI, unit: "gwei", rationale: "Priorytet dodawany do baseFee przy szacowaniu kosztu gazu na żywo.", usedIn: "packages/shared/src/constants.ts" },
  { name: "BLOCK_CLUSTER_GAP_MAX", value: BLOCK_CLUSTER_GAP_MAX, unit: "bloki", rationale: "Sąsiednie okazje bez wspólnej tx konsumującej tworzą jedną grupę podziału (ADR 0007).", usedIn: "packages/analysis/src/anfis/dataset.ts" },
  { name: "NEGATIVES_PER_POSITIVE", value: NEGATIVES_PER_POSITIVE, unit: "—", rationale: "Podpróbkowanie tła w zbiorze uczącym ANFIS (tło to > 99 % bloków).", usedIn: "packages/analysis/src/anfis/dataset.ts" },
];
