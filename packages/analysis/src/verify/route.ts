/**
 * Klasyfikacja TRASY tx konsumującej okazję (ADR 0003): `realizedProfit`/`pickBeneficiary`
 * (profit.ts) liczą netto WYŁĄCZNIE dwóch tokenów
 * pary. To jest poprawne dla czystego arbitrażu dwupulowego (bot wchodzi jednym tokenem pary,
 * wychodzi drugim), ale FAŁSZYWIE wygląda jak ogromny zysk, gdy konsumująca tx to w
 * rzeczywistości handel usera przez agregator/router zapłacony tokenem SPOZA pary (np. DAI -> …
 * -> WETH -> USDC): netto WETH/USDC dla beneficjenta wygląda jak zysk, a naprawdę to tylko jeden
 * leg wielohopowej trasy cudzej transakcji (na dev DB: max 1,62 mln USD, mediana 1,5 tys. USD
 * "zysku" dla takich tx).
 *
 * `classifyRoute` odróżnia dwa przypadki:
 *  - `two_pool`  — tx dotyka WYŁĄCZNIE dwóch puli pary (żadnego obcego swapu V2, żadnego swapu
 *    V3/innego DEX-u) i nie przesuwa żadnego tokenu spoza pary (WETH Deposit/Withdrawal, czyli
 *    wrap/unwrap, są dozwolone — to nie jest "obcy token", tylko natywna otoczka WETH już
 *    rozliczana przez `decodeWethNativeTransfers`). Dla takich tx `realizedProfit` jest wiarygodny
 *    — zachowanie NIEZMIENIONE względem stanu sprzed tego fixu.
 *  - `multi`     — tx dotyka trzeciej puli/DEX-u albo przenosi token spoza pary: `realizedProfit`
 *    nie jest wiarygodny (nie widzimy całej trasy), więc `classify` (classify.ts) ustawia
 *    `realizedProfitUsd = null` i `profitableConsumed = false`, zachowując `gasCostUsd` (koszt
 *    gazu tej tx jest wiarygodny niezależnie od trasy) i status `consumed_atomic` (okazja BYŁA
 *    skonsumowana — nieznany jest tylko realny zysk konsumenta, nie fakt konsumpcji).
 */
import { eqAddr } from "./direction.js";
import { WETH_CONTRACT } from "./profit.js";
import type { PairMeta, PoolMeta, Receipt } from "./types.js";

/** topic0 `Swap(address,uint256,uint256,uint256,uint256,address)` (Uniswap V2 / Sushiswap V2 — identyczna sygnatura, patrz docs/konwencje.md). */
export const TOPIC_SWAP_V2 = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";

/** topic0 `Swap(address,address,int256,int256,uint160,uint128,int24)` (Uniswap V3). */
export const TOPIC_SWAP_V3 = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";

export type Route = "two_pool" | "multi";

/**
 * `receipt` musi nieść `logs` (adres + topic0, patrz `Receipt.logs`/`parseReceipt`) — bez nich
 * warunki (a)/(c) (obcy Swap V2, Swap V3) nie mogą być sprawdzone i `classifyRoute` traktuje ich
 * brak jako "brak dowodu na multi-route" (pusta lista `?? []`), spadając wyłącznie na warunek (b)
 * (Transfer tokena spoza pary) — zgodne z zachowaniem sprzed fixu dla fixture'ów testowych, które
 * budują `Receipt` ręcznie bez `logs` (jak `nativeLeg`/`transfers` już wcześniej).
 */
export function classifyRoute(receipt: Receipt, pair: PairMeta, pools: readonly PoolMeta[]): Route {
  // topic0 normalizowany tutaj (nie tylko w `parseReceipt`) — fixture'y/inne źródła mogą podać
  // hex w mieszanej wielkości liter, a porównanie ze stałymi jest dokładne.
  const logs = (receipt.logs ?? []).map((l) => ({ address: l.address, topic0: l.topic0.toLowerCase() }));
  const poolAddresses = pools.map((p) => p.address);

  // (a) Swap V2 WYŁĄCZNIE z dwóch puli pary — jakikolwiek inny adres emitujący ten sam topic0 to
  // trzecia pula (np. router skacze przez pulę pośrednią tokenu spoza pary).
  const hasForeignV2Swap = logs.some(
    (l) => l.topic0 === TOPIC_SWAP_V2 && !poolAddresses.some((addr) => eqAddr(addr, l.address)),
  );
  if (hasForeignV2Swap) return "multi";

  // (c) brak swapu V3 (inny kształt zdarzenia/AMM — nie da się dwupulowo rozliczyć).
  const hasV3Swap = logs.some((l) => l.topic0 === TOPIC_SWAP_V3);
  if (hasV3Swap) return "multi";

  // (b) brak Transferu tokena spoza pary; WETH (wrap/unwrap) dozwolony niezależnie od tego, czy
  // WETH jest tokenem pary — to nie "obcy token", tylko natywna otoczka rozliczana osobno.
  const allowedTokens = [pair.tokenBase, pair.tokenQuote, WETH_CONTRACT];
  const hasForeignTransfer = receipt.transfers.some((t) => !allowedTokens.some((addr) => eqAddr(addr, t.address)));
  if (hasForeignTransfer) return "multi";

  return "two_pool";
}
