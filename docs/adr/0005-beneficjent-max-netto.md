# ADR 0005: Beneficjent konsumpcji = adres o maksymalnym netto USD

**Status:** przyjęty · **Data:** 2026-08-26 · **Dotyczy:** `packages/analysis/src/verify/profit.ts` (`pickBeneficiary`, `candidateAddresses`, `tieRank`, `beneficiaryKind`)

## Kontekst
Poprzednia heurystyka (`AtomicCandidate.beneficiary`, `detect.ts`) wymagała, żeby oba swapy
konsumującej tx miały wspólny adres `to`, inaczej klasyfikacja spadała na `receipt.from` (EOA
inicjujące tx). W praktyce boty MEV bardzo często przekazują wynik pierwszego swapu wprost do
drugiej puli (oszczędność gazu — pomijają „odbiór" tokenu pośredniego), więc `to` różni się między
pulami i realny zysk trafia do kontraktu bota, a nie do `receipt.from`. Efekt w oknie 2 (WETH/USDC):
`realized_profit_usd = 0` dla 122/198 = 62% `consumed_atomic` — nie dlatego, że konsumpcja była nierentowna, tylko dlatego, że heurystyka nie
znajdowała żadnego kandydata z dodatnim netto.

## Decyzja
`pickBeneficiary` zbiera WSZYSTKICH kandydatów: `to` obu swapów, `tx.from`, `receipt.to` (kontrakt
wywołany wprost), oraz każdy adres odbierający `Transfer` tokena bazowego/kwotowanego pary, który
nie jest jedną z dwóch puli (adresy pul wykluczone bezwarunkowo, niezależnie od źródła kandydata).
Dla każdego kandydata liczy `realizedProfit` (netto USD przepływów tokenów pary) i wybiera adres o
wartości MAKSYMALNEJ; przy remisie preferuje `receipt.to`, potem `tx.from` (`tieRank`).
`beneficiaryKind ∈ {swap_to, contract, eoa, other}` jest logowane w wyniku joba, ale nie
persystowane (brak kolumny w `opportunity_verifications`).

## Konsekwencje
+ W oknie 2: `profitable_consumed` wzrosło z 75 do 195 (z 198 `consumed_atomic`, przed dalszym
  fixem trasy ADR 0003) — usunięcie systematycznych fałszywych zer ujawniło rzeczywisty dodatni
  zysk w większości wierszy; mediana `realized_profit_usd` przeszła z 0,00 USD na 1 262,62 USD.
+ Przykład regresji: tx `0x4b29b981…` (blok 12 429 895) — beneficjent = kontrakt bota
  `0x3700006fBCDE59a8B3AF2C134d00e9530000e379` (`receipt.to`), +3,770759 WETH ≈ 14 180,85 USD,
  `gasUsed = 145 877` — zgodne z niezależnym odczytem Etherscan (`known-tx.test.ts`).
+ Po fixach A/B (ADR 0004, self-funded round-trip): w oknie 2, 155 `two_pool` z 198
  `consumed_atomic`, `profitable_consumed = true` dla 153/198, mediana `realized_profit_usd`
  931,52 USD, maks. 143 156,39 USD (opp 444, arbitraż ERC-20 bez nogi natywnej, sprawdzony
  receiptem).
− Heurystyka może wskazać adres pośredni, gdy zysk jest przekazywany dalej (kind `other`, np.
  `0x1d5a…` w `0x19ff166f…`, ADR 0004) — wybór max netto jest wtedy nadal ekonomicznie sensowny
  (to faktyczny odbiorca środków), ale nie musi być właścicielem/operatorem bota.
− Nie śledzi wewnętrznych transferów ETH — źródłem danych jest wyłącznie `eth_getLogs`/receipty na
  standardowym archiwalnym RPC, bez `debug_traceTransaction`, więc adres pośredniczący jest
  identyfikowany wyłącznie z logów Transfer/Deposit/Withdrawal (patrz Alternatywy niżej).

## Alternatywy odrzucone
- Wyłącznie `receipt.to` — traci przypadki bezpośredniego arbitrażu EOA (bez kontraktu
  pośredniczącego), gdzie zysk trafia wprost do `tx.from`.
- Śledzenie wewnętrznych transferów ETH przez `debug_traceTransaction` — nieużyte: źródłem danych tej
  pracy są wyłącznie `eth_getLogs` (ingest) i `eth_getTransactionReceipt` (weryfikacja) na zwykłym
  archiwalnym RPC, bez żadnej metody `trace_*`/`debug_*` (`packages/ingest/src/rpc/client.ts` —
  generyczny `call(method, params)` bez wywołań trace; `packages/analysis/src/verify/receipt.ts`).
