# ADR 0003: Klasyfikacja trasy two_pool/multi i etykieta „nieokreślona"

**Status:** przyjęty · **Data:** 2026-08-26 · **Dotyczy:** `packages/analysis/src/verify/route.ts` (`classifyRoute`), `packages/analysis/src/verify/classify.ts`, `packages/analysis/src/anfis/dataset.ts` (`isUnknownLabel`), migracja `packages/db/drizzle/0005_verification_route.sql`

## Kontekst
`realizedProfit`/`pickBeneficiary` (`profit.ts`) liczą zysk konsumenta wyłącznie z netto dwóch
tokenów pary (WETH/USDC). To poprawne dla czystego arbitrażu dwupulowego, ale transakcja konsumująca
bywa w rzeczywistości handlem usera routowanym przez agregator (Kyber, 1inch) albo trasą przez
Uniswap V3 — wtedy netto dwóch tokenów pary dla wybranego „beneficjenta" wygląda jak zysk rzędu
10⁵ USD, choć to tylko jeden leg cudzej wielohopowej transakcji: tx `0x61af9018…` (okazja 25, okno 2)
dawała pierwotnie 528 428,05 USD „zysku" (trasa przez Kyber) — patrz `docs/verification-method.md`.

## Decyzja
`classifyRoute` (`packages/analysis/src/verify/route.ts`) klasyfikuje trasę tx konsumującej okazję
jako `two_pool`, gdy receipt niesie WYŁĄCZNIE zdarzenia `Swap` V2 dwóch pul analizowanej pary — brak
`Swap` V2 obcej puli, brak `Swap` V3 (topic0 `0xc42079f9…`, inny DEX), brak `Transfer` tokena spoza
pary (WETH `Withdrawal`/`Deposit`, czyli wrap/unwrap, są dozwolone — to nie „obcy token"). W
przeciwnym razie trasa to `multi`: `realized_profit_usd → NULL`, `profitable_consumed → false`,
status pozostaje `consumed_atomic` (okazja BYŁA skonsumowana — nieznany jest tylko realny zysk
konsumenta, nie fakt konsumpcji), a `gas_cost_usd` pozostaje wyliczone (wiarygodne niezależnie od
trasy). Wiersz `route = 'multi'` ma etykietę klasyfikacji binarnej NIEOKREŚLONĄ i jest wykluczony z
populacji uczenia/ewaluacji (`isVerifiedKnownOpportunity`, `packages/analysis/src/anfis/dataset.ts`);
migracja `0005_verification_route` dodaje kolumnę `route` z backfillem ze starego proxy oraz CHECK
`NOT (route = 'multi' AND profitable_consumed)`.

## Konsekwencje
+ Eliminuje fałszywie duże wartości zysku pochodzące z tras wielohopowych/agregatorów (rząd 10⁵–10⁶
  USD zamiast typowych setek–tysięcy USD dla arbitrażu dwupulowego, `docs/verification-method.md`).
+ Status konsumpcji (`consumed_atomic`) i histogram `blocks_to_consumption` pozostają niezmienione —
  fix dotyczy wyłącznie wiarygodności wyceny zysku, nie detekcji konsumpcji.
− Zmniejsza populację o znanej etykiecie: w oknie 2 (WETH/USDC) 198 `consumed_atomic` = 155
  `two_pool` / 43 `multi`; w danych po pełnej macierzy 4 pary ×
  4 okna: 714 `consumed_atomic` ogółem, z czego znaczna część `multi` (per okno w
  `docs/anfis.md`, kolumna „two_pool / multi").
− Trasy wielopulowe (agregatory, V3) są poza zakresem wykrywania tego systemu — ograniczenie
  udokumentowane w `docs/methodology.md` §6d.

## Alternatywy odrzucone
- Liczyć `multi` jako negatyw (`profitable_consumed = false` przez brak dowodu) — systematycznie
  zaniżałoby recall modeli (okazja BYŁA skonsumowana, tylko zysk nieznany — to nie to samo co
  „nieopłacalna").
- Próba rozliczenia wielohopowych tras (wycena wszystkich tokenów po drodze) — poza zakresem tej
  pracy: wymaga cen tokenów spoza analizowanej pary i integracji z cenami zewnętrznych rynków.
