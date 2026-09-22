/**
 * Zysk realny konsumpcji okazji: przepływy netto tokenów pary z logów ERC-20 Transfer
 * dla beneficjenta transakcji, przeliczone na USD, plus koszt gazu. Czysta logika bez I/O.
 *
 * Dekodowanie logów Transfer jest ręczne (topics[1]/[2] to zaadresowane 32-bajtowo
 * adresy, `data` to uint256) zamiast przez ethers.Interface — unika to dodawania
 * zależności `ethers` do @dex-arb/analysis tylko dla jednej, prostej dekodowanej struktury.
 */
import { eqAddr } from "./direction.js";
import type { BeneficiaryKind, PairMeta, PoolMeta, Receipt, TransferLog } from "./types.js";

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Topic0 zdarzenia WETH `Withdrawal(address indexed src, uint256 wad)` (unwrap WETH -> ETH).
 *
 * HISTORIA (ADR 0004): pierwotnie CELOWO pomijany jako odpływ, z założeniem "bot dostaje WETH
 * przez Transfer (już liczony przez `tokenNetFlow`) i sam go unwrapuje — ten sam adres, ten sam
 * moment, więc liczenie Withdrawal osobno podwójnie obciążałoby ten sam przepływ". Założenie
 * okazało się fałszywe dla wzorca "router unwrapuje WETH i przekazuje wynikowy natywny ETH
 * DALEJ, poza logami" — tx `0x61af9018…`, opp 25 w `docs/verification-checklist.md`: router
 * odbiera 167,04 WETH Transferem, unwrapuje WSZYSTKO Withdrawal-em, ale wynikowy ETH trafia do
 * wywołującego bota/EOA bez żadnego logu — bez rozliczenia Withdrawal router fałszywie wygląda
 * jak beneficjent całej kwoty, zamiast rzeczywistego ~0,5 WETH zysku bota. Teraz rozliczany przez
 * `decodeWethNativeTransfers` (syntetyczne wpisy `TransferLog` na adresie `WETH_CONTRACT`,
 * dołączane do `receipt.transfers` w `parseReceipt`) — patrz komentarz tej funkcji dla pełnej
 * heurystyki src/dst.
 */
export const WETH_WITHDRAWAL_TOPIC = "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65";

/** Topic0 zdarzenia WETH `Deposit(address indexed dst, uint256 wad)` (wrap ETH -> WETH) — druga
 * połowa heurystyki `decodeWethNativeTransfers`, patrz tam. */
export const WETH_DEPOSIT_TOPIC = "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c";

/** Adres kontraktu WETH na Ethereum mainnet (patrz docs/konwencje.md) — jedyny kontrakt, na którym
 * dekodujemy Withdrawal/Deposit (nie próbujemy generalizować na inne "wrapped native" tokeny,
 * poza zakresem tego etapu/pary WETH/USDC). */
export const WETH_CONTRACT = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

export interface PriceRef {
  baseUsd: number;
  quoteUsd: number;
}

export interface RealizedProfit {
  netBase: bigint;
  netQuote: bigint;
  profitUsd: number;
  gasCostUsd: number;
}

/** Suma wpływów minus odpływy danego tokenu dla beneficjenta (porównanie adresów bez uwzględniania wielkości liter). */
export function tokenNetFlow(transfers: TransferLog[], token: string, beneficiary: string): bigint {
  let net = 0n;
  for (const t of transfers) {
    if (!eqAddr(t.address, token)) continue;
    if (eqAddr(t.to, beneficiary)) net += t.value;
    if (eqAddr(t.from, beneficiary)) net -= t.value;
  }
  return net;
}

const toUnits = (v: bigint, decimals: number): number => Number(v) / 10 ** decimals;

/** Zysk realny = przepływy netto tokenów pary dla beneficjenta wycenione po cenach z bloku konsumpcji, minus koszt gazu (osobno w gasCostUsd). */
export function realizedProfit(
  receipt: Receipt,
  beneficiary: string,
  pair: PairMeta,
  price: PriceRef,
  ethUsd: number,
): RealizedProfit {
  const netBase = tokenNetFlow(receipt.transfers, pair.tokenBase, beneficiary);
  const netQuote = tokenNetFlow(receipt.transfers, pair.tokenQuote, beneficiary);
  const profitUsd =
    toUnits(netBase, pair.baseDecimals) * price.baseUsd + toUnits(netQuote, pair.quoteDecimals) * price.quoteUsd;
  const gasCostUsd = (Number(receipt.gasUsed * receipt.effectiveGasPrice) / 1e18) * ethUsd;
  return { netBase, netQuote, profitUsd, gasCostUsd };
}

export interface BeneficiaryChoice {
  address: string;
  kind: BeneficiaryKind;
  profit: RealizedProfit;
}

/**
 * Kandydaci na beneficjenta konsumpcji atomowej (ADR 0005):
 * `to` obu swapów kandydata, `tx.from` (`receipt.from`), kontrakt wywołany (`receipt.to`), oraz
 * KAŻDY adres odbierający Transfer tokena bazowego/kwotowanego tej tx, który nie jest jedną z
 * dwóch puli. Adresy puli są wykluczone bezwarunkowo (nigdy nie mogą zostać beneficjentem),
 * niezależnie z jakiego źródła by pochodziły — dawny heurystyk `AtomicCandidate.beneficiary`
 * (wspólne `to` obu swapów) i literalny `tx.from` łapały zbyt wąsko: boty MEV często
 * przekazują token pośredni bezpośrednio między pulami (`to` się różni) albo przesyłają zysk
 * przez kontrakt pośredniczący, więc ani `to`, ani `receipt.from` nie odbiera realnie zysku.
 */
function candidateAddresses(candidateSwaps: { to: string }[], receipt: Receipt, pair: PairMeta, pools: readonly PoolMeta[]): string[] {
  const isPool = (addr: string): boolean => pools.some((p) => eqAddr(p.address, addr));
  const transferRecipients = receipt.transfers
    .filter((t) => eqAddr(t.address, pair.tokenBase) || eqAddr(t.address, pair.tokenQuote))
    .map((t) => t.to);
  const all = [...candidateSwaps.map((s) => s.to), receipt.from, ...(receipt.to ? [receipt.to] : []), ...transferRecipients];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const addr of all) {
    const lower = addr.toLowerCase();
    if (isPool(lower) || seen.has(lower)) continue;
    seen.add(lower);
    out.push(lower);
  }
  return out;
}

/** 0 = najwyższy priorytet przy remisie netto USD: `receipt.to`, potem `tx.from`, potem reszta. */
function tieRank(addr: string, receipt: Receipt): number {
  if (receipt.to && eqAddr(receipt.to, addr)) return 0;
  if (eqAddr(receipt.from, addr)) return 1;
  return 2;
}

/**
 * Priorytet ETYKIETY (nie wyboru adresu — patrz `tieRank`/pętla w `pickBeneficiary`, to inny
 * porządek): `contract` i `eoa` to sygnały pewne (wiemy JAWNIE, że to kontrakt wywołany / adres
 * inicjujący tx), więc wygrywają nad `swap_to` (dawna heurystyka, mniej precyzyjna — adres
 * odbierający `to` swapu bywa też kontraktem lub EOA). `other` tylko gdy adres pochodzi
 * WYŁĄCZNIE z logów Transfer (np. zysk przekazany dalej, poza `to` swapów i poza tx.from/to).
 * Efekt: bezpośredni arbitraż EOA -> `eoa`; bot wywołany wprost, zysk zostaje w nim -> `contract`;
 * bot przekazuje zysk do oddzielnego adresu (EOA właściciela lub innego kontraktu) -> `other`.
 */
function beneficiaryKind(addr: string, candidateSwaps: { to: string }[], receipt: Receipt): BeneficiaryKind {
  if (receipt.to && eqAddr(receipt.to, addr)) return 'contract';
  if (eqAddr(receipt.from, addr)) return 'eoa';
  if (candidateSwaps.some((s) => eqAddr(s.to, addr))) return 'swap_to';
  return 'other';
}

/**
 * Wybiera beneficjenta spośród `candidateAddresses`: adres o MAKSYMALNYM netto USD przepływów
 * tokenów pary (`realizedProfit` policzony dla każdego kandydata); przy remisie preferuje
 * `receipt.to`, potem `tx.from` (`tieRank`). Zwraca `null` tylko gdy zbiór kandydatów jest pusty
 * (np. `receipt.from`/`receipt.to` i wszystkie `to` swapów okazały się adresami puli — w
 * praktyce nie zdarza się dla realnych tx, ale `classify` ma bezpieczny fallback).
 */
export function pickBeneficiary(
  candidateSwaps: { to: string }[],
  receipt: Receipt,
  pair: PairMeta,
  pools: readonly PoolMeta[],
  price: PriceRef,
  ethUsd: number,
): BeneficiaryChoice | null {
  const addresses = candidateAddresses(candidateSwaps, receipt, pair, pools);
  if (addresses.length === 0) return null;

  let best: { address: string; profit: RealizedProfit; rank: number } | null = null;
  for (const address of addresses) {
    const profit = realizedProfit(receipt, address, pair, price, ethUsd);
    const rank = tieRank(address, receipt);
    if (!best || profit.profitUsd > best.profit.profitUsd || (profit.profitUsd === best.profit.profitUsd && rank < best.rank)) {
      best = { address, profit, rank };
    }
  }

  return { address: best!.address, kind: beneficiaryKind(best!.address, candidateSwaps, receipt), profit: best!.profit };
}

const topicToAddr = (t: string): string => "0x" + t.slice(-40).toLowerCase();

/**
 * Dekoduje logi Transfer(address indexed from, address indexed to, uint256 value).
 * Pomija logi o innym topic0 oraz nietypowe warianty (np. ERC-721 bez `data`/z `to` w
 * trzecim topicu zamiast w `data`) — dla tego etapu interesują nas wyłącznie tokeny ERC-20.
 */
export function decodeTransferLogs(logs: { address: string; topics: string[]; data: string }[]): TransferLog[] {
  const out: TransferLog[] = [];
  for (const l of logs) {
    if (l.topics.length !== 3 || l.topics[0]!.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (!l.data || l.data === "0x") continue;
    out.push({
      address: l.address.toLowerCase(),
      from: topicToAddr(l.topics[1]!),
      to: topicToAddr(l.topics[2]!),
      value: BigInt(l.data),
    });
  }
  return out;
}

export interface NativeLegResult {
  transfers: TransferLog[];
  /** `true` gdy zdekodowano co najmniej jeden Withdrawal/Deposit — patrz `Receipt.nativeLeg`. */
  nativeLeg: boolean;
}

/**
 * Dekoduje `Withdrawal(address indexed src, uint256 wad)` / `Deposit(address indexed dst,
 * uint256 wad)` na kontrakcie `WETH_CONTRACT` i syntetyzuje z nich pseudo-Transfery WETH
 * (`address: WETH_CONTRACT`) — dołączane do `receipt.transfers` w `parseReceipt`, żeby
 * `tokenNetFlow`/`pickBeneficiary` widziały je jak zwykłe przepływy tokenu bazowego, bez zmian
 * w ich logice.
 *
 * Powód: unwrap/wrap WETH<->ETH NIE emituje logu Transfer — natywny ETH po unwrapie leci
 * zwykłym `call` z wartością, poza logami. Router, który odbiera WETH Transferem i sam go
 * unwrapuje, wyglądałby więc jak beneficjent CAŁEJ kwoty, mimo że natywny ETH po unwrapie
 * faktycznie trafia dalej (do wywołującego bota/EOA) — dokładnie wzorzec tx `0x61af9018…`
 * (opp 25, `docs/verification-checklist.md`): router odbiera 167,04 WETH, unwrapuje WSZYSTKO,
 * realny zysk bota to ~0,5 WETH (różnica względem WETH, które sam wcześniej wysłał do puli
 * jako wsad), nie 167,04 WETH przypisane routerowi.
 *
 * Reguła (ADR 0004): ETH i WETH to JEDEN aktyw, a noga
 * natywna (ETH, którego receipt nie pokazuje) jest ZAWSZE przypisywana `receipt.from` — EOA,
 * które ostatecznie finansuje `msg.value` tx i odbiera natywny ETH na końcu:
 *  - Deposit(dst, wad):    +wad dla `dst` (świeży WETH z wrapu), −wad dla `receipt.from`.
 *  - Withdrawal(src, wad): −wad dla `src` (WETH unwrapowane), +wad dla `receipt.from`.
 * Efekt: kontrakt-wykonawca, który sam zawija wsad (Deposit), robi dwa swapy i odwija CAŁY wynik
 * (Withdrawal) — wzorzec tx `0x972cc34a…` (opp 154) / `0x19ff166f…` (opp 479) — nettuje się do 0,
 * a `receipt.from` dostaje wynik − wsad (0x972cc34a: 762,89 − 746,02 ≈ 16,87 WETH). POPRZEDNIA
 * wersja (`src === receiptTo ? receiptFrom : receiptTo` dla Withdrawal, Deposit na `receiptTo`
 * jako samoprzelew) przypisywała w tym wzorcu CAŁE 762,89 WETH `receipt.from` (1,62 mln USD
 * fałszywego zysku, patrz docs/verification-checklist.md). Wzorzec `0x61af9018…` (opp 25:
 * router ≠ receipt.to unwrapuje dla bota) nadal daje `receipt.from` ≈ 0,5 WETH. Parametr
 * `receiptTo` zachowany wyłącznie dla zgodności sygnatury z `parseReceipt` — nieużywany.
 */
export function decodeWethNativeTransfers(
  logs: { address: string; topics: string[]; data: string }[],
  receiptFrom: string,
  _receiptTo: string | null,
): NativeLegResult {
  const transfers: TransferLog[] = [];
  let nativeLeg = false;
  for (const l of logs) {
    if (!eqAddr(l.address, WETH_CONTRACT)) continue;
    if (l.topics.length !== 2) continue;
    if (!l.data || l.data === "0x") continue;
    const topic0 = l.topics[0]!.toLowerCase();
    if (topic0 !== WETH_WITHDRAWAL_TOPIC && topic0 !== WETH_DEPOSIT_TOPIC) continue;

    const account = topicToAddr(l.topics[1]!);
    const wad = BigInt(l.data);
    nativeLeg = true;

    if (topic0 === WETH_WITHDRAWAL_TOPIC) {
      // Withdrawal(src, wad): −wad dla src (unwrap), +wad natywnego ETH dla receipt.from.
      transfers.push({ address: WETH_CONTRACT, from: account, to: receiptFrom, value: wad });
    } else {
      // Deposit(dst, wad): +wad dla dst (wrap), −wad natywnego ETH dla receipt.from.
      transfers.push({ address: WETH_CONTRACT, from: receiptFrom, to: account, value: wad });
    }
  }
  return { transfers, nativeLeg };
}
