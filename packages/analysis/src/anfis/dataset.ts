// @dex-arb/analysis/anfis — zbiór uczący ANFIS: block_states ⋈ opportunities ⋈
// opportunity_verifications dla zadanych okien. Okazje BEZ wiersza weryfikacji mają nieznaną
// prawdziwą etykietę i są pomijane; okazje zweryfikowane (profitable_consumed) trafiają do
// zbioru w CAŁOŚCI (pozytywy i negatywy — nie są podpróbkowywane, jest ich stosunkowo mało).
// Tło (block_states bez okazji, z natury etykieta 0) jest silnie nadreprezentowane (>99% bloków
// wg docs/konwencje.md), więc jest podpróbkowywane deterministycznie (mulberry32(seed), ten sam
// mechanizm co core/anfis/train.ts) do `negativesPerPositive × liczba pozytywów`.
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@dex-arb/db";
import { mulberry32, shuffleInPlace, type Features } from "@dex-arb/core";
import type { Route } from "../verify/route.js";
import type { VerificationStatus } from "../verify/types.js";

const { blockStates, opportunities, opportunityVerifications } = schema;

/** Jeden wiersz zbioru uczącego/oceny: cechy z block_states + status okazji/weryfikacji. */
export interface LabeledRow {
  pairId: number;
  windowId: number;
  block: number;
  s: number;
  g: number;
  l: number;
  m: number;
  netProfitUsd: number;
  optTradeUsd: number;
  /**
   * `block_states.gross_profit_usd` (zysk brutto przed gazem; 0 dla bloku bez kierunku arbitrażu).
   * WYMAGANE — baseline v2 (`calibrate:baseline_v2`, `BaselineV2Model.score`) odtwarza z niego i z
   * `netProfitUsd` koszt gazu v1 (`gasCostV1FromRow` w `@dex-arb/core`), bez żadnego przybliżenia.
   */
  grossProfitUsd: number;
  /** Blok przekroczył próg spreadu (jest wierszem w `opportunities`). */
  isOpportunity: boolean;
  /** Okazja ma wiersz w `opportunity_verifications` (nieistotne, gdy `!isOpportunity`). */
  verified: boolean;
  /** `profitable_consumed` okazji zweryfikowanej; 0, gdy `!isOpportunity` lub `!verified`. */
  label: 0 | 1;
  /**
   * `opportunities.est_profit_usd` (szacunek A PRIORI, przed weryfikacją); `null` gdy `!isOpportunity`.
   * Do liczenia okazji, gdzie szacunek był ujemny, a mimo to okazja okazała się
   * `profitable_consumed` (worker/train.ts, diagnostyka metryk).
   */
  estProfitUsd: number | null;
  /**
   * `opportunity_verifications.consumer_tx_hash`; `null` gdy `!verified` lub konsumpcja nie miała
   * jednej identyfikowalnej transakcji. PIERWSZORZĘDNY klucz grupowy dla podziału train/test (`computeGroupKeys`) — patrz tam po uzasadnienie wycieku.
   */
  consumerTxHash: string | null;
  /**
   * `opportunity_verifications.blocks_to_consumption`; `null` gdy `!verified`. `filterK0` odrzuca wiersze z wartością 0 (opcjonalnie, `trainParams.excludeK0`).
   */
  blocksToConsumption: number | null;
  /**
   * `opportunity_verifications.gas_cost_usd`; `null` gdy `!verified`. Do liczenia „zero-gas consumers" (pakiety Flashbots bez jawnego kosztu gazu w tx, worker/train.ts).
   */
  gasCostUsd: number | null;
  /**
   * `opportunity_verifications.status`; `null`/nieustawione gdy `!verified`. OPCJONALNE (jak
   * `estProfitUsd` itd. — nie wymusza zmian w fixture'ach budujących `LabeledRow` ręcznie);
   * `loadLabeledRows` (produkcja) zawsze je ustawia.
   */
  status?: VerificationStatus | null;
  /**
   * `opportunity_verifications.realized_profit_usd`; `null` gdy `!verified` oraz gdy
   * `route === 'multi'`. Opcjonalne z tego samego powodu co `status`.
   */
  realizedProfitUsd?: number | null;
  /**
   * `opportunity_verifications.route` (migracja 0005; `classifyRoute` w `../verify/route.ts` — tam
   * uzasadnienie). `'multi'` = zweryfikowana, ale zysk konsumenta NIEZNANY: taki wiersz ma nieznaną
   * prawdziwą etykietę i jest pomijany przez `buildDataset` (`meta.nSkippedUnknown`), zamiast
   * liczony jako negatyw (`profitableConsumed=false` znaczy tu "nie wiemy", nie "nierentowna").
   * `null` dla statusów innych niż `consumed_atomic`. Opcjonalne z tego samego powodu co `status`.
   */
  route?: Route | null;
}

/** Wiersz zweryfikowanej okazji o NIEZNANEJ prawdziwej etykiecie (trasa `'multi'`, patrz `LabeledRow.route`). */
export const isUnknownLabel = (r: LabeledRow): boolean => r.route === "multi";

/**
 * Zweryfikowana okazja o ZNANEJ etykiecie (`label` wiarygodne): jest okazją, ma wiersz weryfikacji
 * i trasa ≠ `'multi'`. Jedyny predykat populacji „zweryfikowane okazje" — używany przez
 * `buildDataset`, worker `train.ts` (diagnostyka/ewaluacja) i `calibrateBaselineV2.ts`.
 */
export const isVerifiedKnownOpportunity = (r: LabeledRow): boolean => r.isOpportunity && r.verified && !isUnknownLabel(r);

export interface DatasetOptions {
  /** Liczba wierszy tła (bez okazji) na jeden pozytyw — domyślnie 10 (spec §1, undersampling). */
  negativesPerPositive?: number;
  /** Seed `mulberry32` dla podpróbkowania tła — domyślnie 42, deterministyczne. */
  seed?: number;
}

export interface DatasetMeta {
  /** Liczba zweryfikowanych okazji z `profitable_consumed = true`. */
  nPos: number;
  /** Liczba zweryfikowanych okazji z `profitable_consumed = false` (kept w całości, bez podpróbkowania). */
  nNeg: number;
  /** Liczba wierszy tła po podpróbkowaniu (label 0, `!isOpportunity`). */
  nBackground: number;
  /** Identyfikatory okien obecne w `rows`, posortowane rosnąco. */
  windows: number[];
  /**
   * Liczba zweryfikowanych okazji POMINIĘTYCH, bo mają nieznaną prawdziwą etykietę
   * (`route === 'multi'`, patrz `LabeledRow.route`). Ani pozytyw, ani negatyw — nie liczą się do
   * `nPos`/`nNeg`.
   */
  nSkippedUnknown: number;
}

export interface Dataset {
  /** `X[i] = [S,G,L,M]` w jednostkach naturalnych — wejście `trainAnfis`/`predict`. */
  X: number[][];
  y: (0 | 1)[];
  /**
   * Klucze grupowe (`computeGroupKeys`) wyrównane 1:1 z `X`/`y` (ta sama kolejność co wewnętrzne
   * `all = [...positives, ...negativesOpp, ...sampledBackground]`) — do przekazania jako
   * `trainAnfis` `opts.groups`, żeby WEWNĘTRZNY podział train/val (early stopping) był tak samo
   * grupowo świadomy jak podział train/test na poziomie jobu (worker/jobs/train.ts).
   */
  groups: (string | number)[];
  meta: DatasetMeta;
}

/** `LabeledRow` -> `Features` (@dex-arb/core) — do oceny dowolnym `ScoringModel` (baseline/mamdani/anfis). */
export function toFeatures(r: LabeledRow): Features {
  return { S: r.s, G: r.g, L: r.l, M: r.m, netProfitUsd: r.netProfitUsd, grossProfitUsd: r.grossProfitUsd, optTradeUsd: r.optTradeUsd };
}

/**
 * Czysta część (bez bazy): z wierszy dla danych okien buduje `X`/`y` gotowe do `trainAnfis`.
 * Deterministyczna dla danego `seed` — jedyne pseudolosowe wybory (które wiersze tła trafiają do
 * próbki) pochodzą z jednego `mulberry32(seed)`, tak jak trening ANFIS w `@dex-arb/core`.
 */
export function buildDataset(rows: LabeledRow[], opts: DatasetOptions = {}): Dataset {
  const { negativesPerPositive = 10, seed = 42 } = opts;

  const verifiedOpp = rows.filter((r) => r.isOpportunity && r.verified);
  // `route === 'multi'` (patrz `LabeledRow.route`) ma nieznaną prawdziwą etykietę — ani pozytyw,
  // ani negatyw. Pomijamy TUTAJ (samo `label === 0` liczyłoby je jako negatyw).
  const skippedUnknown = verifiedOpp.filter(isUnknownLabel);
  const knownVerifiedOpp = rows.filter(isVerifiedKnownOpportunity);
  const positives = knownVerifiedOpp.filter((r) => r.label === 1);
  const negativesOpp = knownVerifiedOpp.filter((r) => r.label === 0);
  const background = rows.filter((r) => !r.isOpportunity);

  const rng = mulberry32(seed);
  const shuffled = [...background];
  shuffleInPlace(shuffled, rng);
  const sampledBackground = shuffled.slice(0, Math.min(shuffled.length, negativesPerPositive * positives.length));

  const all = [...positives, ...negativesOpp, ...sampledBackground];
  const windows = [...new Set(rows.map((r) => r.windowId))].sort((a, b) => a - b);

  return {
    X: all.map((r) => [r.s, r.g, r.l, r.m]),
    y: all.map((r) => (r.isOpportunity ? r.label : 0) as 0 | 1),
    groups: computeGroupKeys(all),
    meta: {
      nPos: positives.length,
      nNeg: negativesOpp.length,
      nBackground: sampledBackground.length,
      windows,
      nSkippedUnknown: skippedUnknown.length,
    },
  };
}

/**
 * Opcjonalnie odrzuca zweryfikowane okazje z
 * `blocks_to_consumption = 0`. `block_states` to stan NA KONIEC bloku — k=0 oznacza więc, że
 * konsumująca transakcja wykonała się w TYM SAMYM bloku, w którym policzono S/G/L/M okazji („arb
 * wykonany w tym bloku"), a nie „okazję odkryto, a skonsumowano ją dopiero w kolejnym bloku" —
 * to inny reżim czasowy niż k>0, stąd opcjonalne wykluczenie (domyślnie wyłączone), a nie trwała
 * zmiana etykietowania. Wiersze tła i okazje bez weryfikacji nie są tym filtrem ruszane.
 */
export function filterK0(rows: LabeledRow[]): LabeledRow[] {
  return rows.filter((r) => !(r.isOpportunity && r.verified && r.blocksToConsumption === 0));
}

/** Maksymalna przerwa (w blokach) między kolejnymi okazjami TEJ SAMEJ pary, żeby uznać je za jeden klaster (patrz `computeGroupKeys`). */
export const BLOCK_CLUSTER_GAP_MAX = 3;

/**
 * Klucz grupowy KAŻDEGO wiersza (indeksy 1:1 z `rows`) do GRUPOWO ŚWIADOMEGO podziału train/test
 * — w danych 198 zweryfikowanych atomowych
 * okazji pochodzi tylko z 129 unikalnych `consumer_tx_hash` — sąsiednie okazje tej samej pary
 * (blok B, B+1, B+2 …) potrafią dzielić TĘ SAMĄ konsumującą transakcję i mieć niemal identyczne
 * cechy/etykietę. Losowy/czasowy podział wiersz-po-wierszu przeciekałby taką grupę jednocześnie
 * do train i test (sztucznie zawyżona metryka — model „widział" niemal ten sam przykład).
 *
 * Reguła:
 *  - zweryfikowana okazja z `consumerTxHash` -> grupa = ta transakcja (`tx:<hash>`)
 *  - okazja bez `consumerTxHash` (np. status `persisted`/`decayed`) -> grupa = klaster kolejnych
 *    okazji TEJ SAMEJ pary W TYM SAMYM OKNIE, których bloki dzieli przerwa <= `BLOCK_CLUSTER_GAP_MAX`
 *    (`cluster:<pairId>:<windowId>:<id>`) — `windowId` w kluczu zapobiega
 *    scaleniu klastrów przez granicę okna przy treningu na wielu oknach naraz: bloki blisko siebie
 *    LICZBOWO, ale z różnych okien (np. koniec okna 1 i początek okna 2 o zbliżonych numerach
 *    bloków bezwzględnych), nie są tą samą sekwencją czasową i nie powinny dzielić grupy.
 *  - tło (`!isOpportunity`) -> singleton, własna grupa (`bg:<pairId>:<block>`) — nie jest częścią
 *    żadnej konsumpcji, więc nie ma tu ryzyka wycieku opisanego wyżej.
 */
export function computeGroupKeys(rows: LabeledRow[]): string[] {
  const keys = new Array<string>(rows.length);
  const byPairWindow = new Map<string, { idx: number; block: number; pairId: number; windowId: number }[]>();

  rows.forEach((r, i) => {
    if (r.isOpportunity && r.verified && r.consumerTxHash) {
      keys[i] = `tx:${r.consumerTxHash}`;
    } else if (r.isOpportunity) {
      const entry = { idx: i, block: r.block, pairId: r.pairId, windowId: r.windowId };
      const pairWindowKey = `${r.pairId}:${r.windowId}`;
      const arr = byPairWindow.get(pairWindowKey);
      if (arr) arr.push(entry);
      else byPairWindow.set(pairWindowKey, [entry]);
    } else {
      keys[i] = `bg:${r.pairId}:${r.block}`;
    }
  });

  for (const entries of byPairWindow.values()) {
    const sorted = [...entries].sort((a, b) => a.block - b.block);
    let clusterId = 0;
    let prevBlock: number | null = null;
    for (const e of sorted) {
      if (prevBlock !== null && e.block - prevBlock > BLOCK_CLUSTER_GAP_MAX) clusterId++;
      keys[e.idx] = `cluster:${e.pairId}:${e.windowId}:${clusterId}`;
      prevBlock = e.block;
    }
  }

  return keys;
}

/**
 * SQL: `block_states LEFT JOIN opportunities LEFT JOIN opportunity_verifications` dla
 * `windowIds` — jeden wiersz na (pair_id, block) tych okien, niezależnie od tego, czy blok jest
 * okazją. Posortowane wg (pair_id, block) — porządek deterministyczny, przydatny dalej dla
 * chronologicznego podziału train/test bez losowości (worker, `splitTrainTestByTime`).
 */
export async function loadLabeledRows(db: Db, windowIds: number[]): Promise<LabeledRow[]> {
  if (windowIds.length === 0) return [];
  const rows = await db
    .select({
      pairId: blockStates.pairId,
      windowId: blockStates.windowId,
      block: blockStates.block,
      s: blockStates.s,
      g: blockStates.g,
      l: blockStates.l,
      m: blockStates.m,
      netProfitUsd: blockStates.baselineNetProfitUsd,
      optTradeUsd: blockStates.optTradeUsd,
      grossProfitUsd: blockStates.grossProfitUsd,
      oppId: opportunities.id,
      estProfitUsd: opportunities.estProfitUsd,
      verifiedOppId: opportunityVerifications.opportunityId,
      profitable: opportunityVerifications.profitableConsumed,
      consumerTxHash: opportunityVerifications.consumerTxHash,
      blocksToConsumption: opportunityVerifications.blocksToConsumption,
      gasCostUsd: opportunityVerifications.gasCostUsd,
      status: opportunityVerifications.status,
      realizedProfitUsd: opportunityVerifications.realizedProfitUsd,
      route: opportunityVerifications.route,
    })
    .from(blockStates)
    .leftJoin(opportunities, and(eq(opportunities.pairId, blockStates.pairId), eq(opportunities.block, blockStates.block)))
    .leftJoin(opportunityVerifications, eq(opportunityVerifications.opportunityId, opportunities.id))
    .where(inArray(blockStates.windowId, windowIds))
    .orderBy(asc(blockStates.pairId), asc(blockStates.block));

  return rows.map((r) => ({
    pairId: r.pairId,
    windowId: r.windowId,
    block: r.block,
    s: r.s,
    g: r.g,
    l: r.l,
    m: r.m,
    // TU (i tylko tu) NULL `baseline_net_profit_usd`/`opt_trade_usd` (kolumny nullable w block_states)
    // staje się 0 — dalej (`gasCostV1FromRow`, baseline v2) net=0 przy gross=0 znaczy „brak
    // kierunku arbitrażu", a `gross_profit_usd` jest NOT NULL DEFAULT 0.
    netProfitUsd: r.netProfitUsd ?? 0,
    optTradeUsd: r.optTradeUsd ?? 0,
    grossProfitUsd: r.grossProfitUsd,
    isOpportunity: r.oppId != null,
    verified: r.verifiedOppId != null,
    label: (r.profitable ? 1 : 0) as 0 | 1,
    estProfitUsd: r.estProfitUsd,
    consumerTxHash: r.consumerTxHash,
    blocksToConsumption: r.blocksToConsumption,
    gasCostUsd: r.gasCostUsd,
    status: r.status,
    realizedProfitUsd: r.realizedProfitUsd,
    route: r.route,
  }));
}
