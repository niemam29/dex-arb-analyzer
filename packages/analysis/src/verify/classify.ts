/**
 * Klasyfikacja statusu okazji arbitrażowej (consumed_atomic | consumed_partial | decayed |
 * persisted) — czysta logika bez I/O. Patrz sekcja "Definicje kluczowe" (punkt "Statusy")
 * w planie etapu 4.
 *
 * `pickCandidate` i `classify` są rozdzielone celowo: job pobiera receipt przez RPC tylko
 * dla wybranego kandydata (pierwsza atomowa tx w B..B+K_MAX), nie dla każdej tx z okna.
 */
import { findAtomicCandidates, findPartialConsumer } from "./detect.js";
import type { AtomicCandidate, DetectContext } from "./detect.js";
import { pickBeneficiary, realizedProfit } from "./profit.js";
import type { PriceRef } from "./profit.js";
import { classifyRoute } from "./route.js";
import type { Receipt, SwapRow, VerificationResult } from "./types.js";

export const K_MAX = 3;

export interface OpportunityInput {
  id: number;
  block: number;
  spreadPct: number;
  expensivePoolId: number;
}

export interface ClassifyInput {
  opp: OpportunityInput;
  /** swapy z bloków B..B+K_MAX obu puli */
  swaps: SwapRow[];
  /** spread z block_states w danym bloku (ostatni znany <= block, zgodnie z definicją w planie) */
  spreadAt: (block: number) => number;
  thresholdPct: number;
  ctx: DetectContext;
}

const inWindow = (opp: OpportunityInput) => (s: SwapRow) => s.block >= opp.block && s.block <= opp.block + K_MAX;

/** Pierwsza (wg block, logIndex) atomowa tx w oknie B..B+K_MAX, albo null. */
export function pickCandidate(input: ClassifyInput): AtomicCandidate | null {
  const swaps = input.swaps.filter(inWindow(input.opp));
  return findAtomicCandidates(swaps, input.ctx)[0] ?? null;
}

/** Pierwsze k ∈ 0..K_MAX, dla którego spread < próg; null gdy spread utrzymał się we wszystkich B..B+K_MAX. */
function firstDecayK(input: ClassifyInput): number | null {
  for (let k = 0; k <= K_MAX; k++) {
    if (input.spreadAt(input.opp.block + k) < input.thresholdPct) return k;
  }
  return null;
}

/**
 * Klasyfikuje okazję na podstawie ewentualnego kandydata na atomowy arbitraż (z
 * `pickCandidate`) i jego receiptu. Gdy nie ma potwierdzonej atomowej konsumpcji (brak
 * kandydata, brak receiptu lub receipt nieudany — `status !== 1`), spada do logiki spreadu:
 * consumed_partial / decayed / persisted.
 */
export function classify(
  input: ClassifyInput,
  candidate: AtomicCandidate | null,
  receipt: Receipt | null,
  price: PriceRef,
  ethUsd: number,
): VerificationResult {
  const { opp } = input;
  // Pola wspólne wszystkim statusom oprócz consumed_atomic. Celowo bez `status` — każdy
  // `return` niżej ustawia go jawnie, żeby nie było niezauważonej wartości domyślnej.
  const base: Omit<VerificationResult, "status"> = {
    opportunityId: opp.id,
    consumerTxHash: null,
    realizedProfitUsd: null,
    gasUsed: null,
    gasCostUsd: null,
    blocksToConsumption: null,
    profitableConsumed: false,
    beneficiary: null,
    beneficiaryKind: null,
    nativeLeg: null,
    route: null,
  };

  if (candidate && receipt && receipt.status === 1) {
    // ADR 0005: `pickBeneficiary` przegląda WSZYSTKICH kandydatów (to obu swapów, tx.from,
    // kontrakt wywołany, odbiorcy Transferu tokena pary z pominięciem puli) i wybiera adres o
    // maksymalnym netto USD — zastępuje dawną heurystykę "wspólne `to` obu swapów, inaczej
    // `receipt.from`", która zaniżała `realized_profit_usd` do 0 dla ok. 62% `consumed_atomic`
    // w oknie maj-2021 (patrz docs/verification-checklist.md). Fallback do starej logiki tylko
    // w teoretycznym przypadku pustego zbioru kandydatów (patrz `pickBeneficiary` — w praktyce
    // się nie zdarza).
    const choice = pickBeneficiary(candidate.swaps, receipt, input.ctx.pair, input.ctx.pools, price, ethUsd);
    const beneficiary = choice?.address ?? candidate.beneficiary ?? receipt.from;
    const p = choice?.profit ?? realizedProfit(receipt, beneficiary, input.ctx.pair, price, ethUsd);
    // ADR 0003: dla trasy `multi` (uzasadnienie — nagłówek route.ts) netto dwóch tokenów
    // pary NIE jest zyskiem konsumenta, więc `realizedProfitUsd` idzie na `null`; status pozostaje
    // `consumed_atomic` (okazja BYŁA skonsumowana), `gasCostUsd` pozostaje wyliczone.
    // `profitableConsumed` wynika WYŁĄCZNIE z `realizedProfitUsd` (nie z `route`), więc CHECK
    // `NOT (route='multi' AND profitable_consumed)` (migracja 0005) jest spełniony strukturalnie.
    const route = classifyRoute(receipt, input.ctx.pair, input.ctx.pools);
    const realizedProfitUsd = route === "multi" ? null : p.profitUsd;
    return {
      ...base,
      status: "consumed_atomic",
      consumerTxHash: candidate.txHash,
      realizedProfitUsd,
      gasUsed: receipt.gasUsed,
      gasCostUsd: p.gasCostUsd,
      blocksToConsumption: candidate.block - opp.block,
      profitableConsumed: realizedProfitUsd !== null && realizedProfitUsd - p.gasCostUsd > 0,
      beneficiary,
      beneficiaryKind: choice?.kind ?? null,
      // `receipt.nativeLeg` (ADR 0004, patrz `decodeWethNativeTransfers`
      // w profit.ts) — `true` gdy przynajmniej jeden Withdrawal/Deposit WETH wpłynął na netto
      // beneficjenta w tej tx. `??` tylko dla `Receipt` budowanych ręcznie w testach bez tego
      // pola (produkcyjny `parseReceipt` zawsze je ustawia).
      nativeLeg: receipt.nativeLeg ?? false,
      route,
    };
  }

  const decayK = firstDecayK(input);
  if (decayK === null) return { ...base, status: "persisted" };

  // Plan (linie 41-42) wymaga OBU warunków w TYM SAMYM bloku B+decayK: swapu
  // zawężającego spread w tym bloku ORAZ spreadu poniżej progu w tym bloku. Nie
  // wystarczy dowolny wcześniejszy swap w [B, B+decayK) — przy stopniowym decayu
  // (spread trzyma się mimo wcześniejszego zawężającego swapu, dopiero później faktycznie
  // spada) to łapało niepowiązaną tx i błędny blocksToConsumption.
  const decayBlock = opp.block + decayK;
  const swapsAtDecayBlock = input.swaps.filter((s) => s.block === decayBlock);
  const partial = findPartialConsumer(swapsAtDecayBlock, input.ctx, opp.expensivePoolId);
  if (partial) {
    return { ...base, status: "consumed_partial", consumerTxHash: partial.txHash, blocksToConsumption: decayK };
  }
  return { ...base, status: "decayed", blocksToConsumption: decayK };
}
