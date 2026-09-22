# ADR 0004: ETH i WETH jako jeden aktyw; noga natywna zawsze na `receipt.from`

**Status:** przyjęty · **Data:** 2026-08-26 · **Dotyczy:** `packages/analysis/src/verify/profit.ts` (`decodeWethNativeTransfers`), typ `Receipt.nativeLeg`

## Kontekst
Rozliczanie zysku beneficjenta wyłącznie z logów `Transfer` tokenów pary gubi nogę natywną: unwrap/
wrap WETH↔ETH NIE emituje `Transfer` — kontrakt-wykonawca zawija ETH (`Deposit`), robi dwa swapy,
odwija cały wynikowy WETH (`Withdrawal`) do EOA, a natywny ETH po unwrapie leci zwykłym `call`,
poza logami. Stara heurystyka (`src === receipt.to ? receipt.from : receipt.to` dla `Withdrawal`,
`Deposit` na `receipt.to` jako samoprzelew) przypisywała `receipt.from` CAŁĄ kwotę `Withdrawal`
zamiast netto: dla tx `0x972cc34a…` (okazja 154, okno 2) dawało to 762,89 WETH ≈ 1 620 078,61 USD
„zysku"; podobnie `0x19ff166f…` (okazja 479) — 1 164 653,03 USD (`docs/verification-method.md`).

## Decyzja
ETH i WETH to JEDEN aktyw; noga natywna jest zawsze przypisywana `receipt.from` — EOA, które
finansuje `msg.value` transakcji i odbiera natywny ETH na końcu:
`Deposit(dst, wad)` → `+wad` dla `dst`, `−wad` dla `receipt.from`;
`Withdrawal(src, wad)` → `−wad` dla `src`, `+wad` dla `receipt.from`.
Syntetyczne wpisy `TransferLog` (adres `WETH_CONTRACT`) są dołączane do `receipt.transfers`
(`decodeWethNativeTransfers`, `packages/analysis/src/verify/profit.ts`), żeby `tokenNetFlow`/
`pickBeneficiary` widziały je jak zwykłe przepływy tokenu bazowego bez zmian w swojej logice.
`Receipt.nativeLeg = true`, gdy zdekodowano co najmniej jeden `Withdrawal`/`Deposit`.

## Konsekwencje
+ Dla `0x972cc34a…`: kontrakt-wykonawca nettuje się do 0, `receipt.from` (EOA) dostaje
  +16,869766 WETH (762,891026 − 746,02126) → `realized_profit_usd` = 35 824,71 USD (zamiast
  1 620 078,61) — 45× mniejszy, realistyczny rząd wielkości dla tego okna.
+ Dla `0x61af9018…` (okazja 25): `receipt.from` +0,501775 WETH — netting poprawny niezależnie od
  tego fixu (trasa i tak klasyfikowana `multi`, ADR 0003).
+ Dla `0x19ff166f…` (okazja 479): kontrakt netto 0, `receipt.from` +0,495602 WETH, a 10,139267 WETH
  trafia Transferem do adresu spoza `tx.from`/`receipt.to` (`0x1d5a…`) — wybrany jako beneficjent
  przez `pickBeneficiary` (ADR 0005, maks. netto) → `realized_profit_usd` = 21 425,03 USD (zamiast
  1 164 653,03).
+ Dowód na żywo i offline: `packages/analysis/test/verify/known-tx.test.ts` (`describe.skipIf(!RPC_URL)`,
  receipty przez `eth_getTransactionReceipt`, wartości oczekiwane policzone niezależnie z logów WETH
  PRZED napisaniem testu, tolerancja ±1%) oraz `packages/analysis/test/verify/profit.test.ts`.
− Heurystyka zakłada, że `receipt.from` to zawsze finansujące/odbierające ETH konto — nieprawdziwe
  dla wywołań przez kontrakt pośredniczący (relayer), które sam finansuje `msg.value` z własnych
  środków; poza zakresem obserwowanych wzorców w danych tej pracy.

## Alternatywy odrzucone
- Rozgałęzienie po `receipt.to` (poprzednia wersja) — błędne dla self-funded round-trip: kontrakt
  wywołany bezpośrednio wygląda wtedy jak beneficjent całej kwoty `Withdrawal`, mimo że nettuje się
  do zera.
- Ignorowanie `Deposit`/`Withdrawal` całkowicie — gubi zysk botów operujących natywnym ETH
  (typowy wzorzec dla arbitrażu WETH/token), zaniżając realized_profit do zera dla całej tej klasy tx.
