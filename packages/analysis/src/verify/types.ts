/**
 * Typy weryfikacji retrospektywnej okazji arbitrażowych.
 * Bez zależności od db/ingest — czysta logika operuje na zwykłych obiektach.
 */
import type { Route } from './route.js';

export type RawDirection = 'BUY_TOKEN0' | 'BUY_TOKEN1' | 'AMBIGUOUS';
export type PairDirection = 'BUY_BASE' | 'SELL_BASE' | 'AMBIGUOUS';

export interface SwapRow {
  poolId: number;
  block: number;
  logIndex: number;
  txHash: string;
  sender: string;
  to: string;
  amount0In: bigint;
  amount0Out: bigint;
  amount1In: bigint;
  amount1Out: bigint;
  gasPrice: bigint | null;
}

export interface PoolMeta {
  id: number;
  /** Adres on-chain kontraktu puli — używany do wykluczania puli z kandydatów na beneficjenta. */
  address: string;
  token0: string;
  token1: string;
  dexName: string;
}

export interface PairMeta {
  id: number;
  tokenBase: string;
  tokenQuote: string;
  baseDecimals: number;
  quoteDecimals: number;
}

export interface TransferLog {
  address: string;
  from: string;
  to: string;
  value: bigint;
}

export interface Receipt {
  txHash: string;
  from: string;
  /** Kontrakt wywołany przez tx (`receipt.to`) — `null` tylko dla tworzenia kontraktu (nie dotyczy tx arbitrażowych). */
  to: string | null;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  status: 0 | 1;
  /** Prawdziwe Transfery ERC-20 (`decodeTransferLogs`) POŁĄCZONE z syntetycznymi wpisami WETH
   * z `decodeWethNativeTransfers` (unwrap/wrap bez odpowiadającego logu Transfer) — patrz
   * komentarz `decodeWethNativeTransfers` w profit.ts. Konsumenci (`tokenNetFlow`,
   * `pickBeneficiary`) nie muszą wiedzieć o rozróżnieniu — oba typy wpisów mają ten sam kształt
   * `TransferLog` i ten sam adres tokenu (`WETH_CONTRACT`). Opcjonalne, żeby nie wymuszać zmian
   * w istniejących fixture'ach testowych, które budują `Receipt` ręcznie bez logów WETH.
   */
  transfers: TransferLog[];
  /** `true` gdy w tej tx zdekodowano co najmniej jeden Withdrawal/Deposit WETH (ADR 0004 —
   * router, który odbiera WETH i sam go unwrapuje, inaczej wyglądałby jak fałszywy beneficjent,
   * patrz `decodeWethNativeTransfers`). Opcjonalne z tego samego
   * powodu co `transfers` wyżej — `parseReceipt` (produkcja) zawsze go ustawia jawnie.
   */
  nativeLeg?: boolean;
  /**
   * Uproszczone logi tx (adres kontraktu + topic0, oba lowercase) — WYŁĄCZNIE do detekcji trasy
   * (`classifyRoute`, route.ts, ADR 0003): czy tx dotyka jakiejś puli/DEX-u poza dwoma
   * pulami pary (obcy Swap V2, Swap V3). Nie duplikuje `topics[1]/[2]`/`data` — te dekoduje już
   * `transfers` (Transfer ERC-20) / `nativeLeg` (Withdrawal/Deposit WETH), `classifyRoute` innych
   * pól logu nie potrzebuje. Opcjonalne z tego samego powodu co `nativeLeg`/`transfers` — nie
   * wymusza zmian w fixture'ach testowych budujących `Receipt` ręcznie; `parseReceipt`
   * (produkcja) zawsze je ustawia.
   */
  logs?: { address: string; topic0: string }[];
}

export type VerificationStatus = 'consumed_atomic' | 'consumed_partial' | 'decayed' | 'persisted';

/**
 * Skąd wzięto adres beneficjenta wybranego przez `pickBeneficiary` (ADR 0005):
 * `swap_to` — wspólny adres `to` obu swapów; `contract` — kontrakt wywołany przez tx
 * (`receipt.to`); `eoa` — adres inicjujący tx (`receipt.from`); `other` — adres znaleziony
 * wyłącznie jako odbiorca w logach Transfer tokena pary (np. kontrakt pośredniczący, do
 * którego bot przekazuje zysk dalej).
 */
export type BeneficiaryKind = 'swap_to' | 'contract' | 'eoa' | 'other';

export interface VerificationResult {
  opportunityId: number;
  status: VerificationStatus;
  consumerTxHash: string | null;
  realizedProfitUsd: number | null;
  gasUsed: bigint | null;
  gasCostUsd: number | null;
  blocksToConsumption: number | null;
  profitableConsumed: boolean;
  /**
   * Adres beneficjenta wybrany przez `pickBeneficiary` (consumed_atomic) — `null` dla innych
   * statusów. Nie ma odpowiadającej kolumny w `opportunity_verifications` (celowo bez migracji —
   * pole diagnostyczne, nie wymaga trwałego przechowywania); `runVerifyPairWindow` go loguje,
   * nie persystuje.
   */
  beneficiary: string | null;
  beneficiaryKind: BeneficiaryKind | null;
  /** `receipt.nativeLeg` propagowane tutaj (consumed_atomic) — `null` dla innych statusów, tak
   * samo jak `beneficiary`/`beneficiaryKind`: brak kolumny w `opportunity_verifications`
   * (pole diagnostyczne, celowo bez migracji), `runVerifyPairWindow` je loguje, nie persystuje. */
  nativeLeg: boolean | null;
  /**
   * Trasa konsumującej tx wg `classifyRoute` (route.ts — tam uzasadnienie) — `null` dla statusów
   * innych niż `consumed_atomic`. `'multi'` implikuje `realizedProfitUsd = null` i
   * `profitableConsumed = false`. Persystowane w kolumnie `opportunity_verifications.route`
   * (migracja 0005, CHECK-i: route tylko przy consumed_atomic; NOT(multi AND profitable)).
   */
  route: Route | null;
}
