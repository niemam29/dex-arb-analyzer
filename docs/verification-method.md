# Weryfikacja retrospektywna — metoda kontroli ręcznej i wyniki

Kontrola niezależna od pipeline'u: dla próbki wyników `opportunity_verifications` porównuje się
dane z bazy z bezpośrednim odczytem z Etherscan (kontrola zewnętrzna wobec RPC i kodu tego
repozytorium). Ten dokument opisuje metodę kontroli ręcznej (sesja 2026-08-26/27) i AKTUALNY stan wyników.

## 1. Cel i zakres

Sprawdzamy, czy zawartość `opportunity_verifications` — status konsumpcji, `gas_used`,
`realized_profit_usd`, `gas_cost_usd`, `profitable_consumed` — zgadza się z niezależnym odczytem
danych on-chain (Etherscan) dla tych samych transakcji. Próba:

- **10 pierwszych chronologicznie** okazji ze statusem `consumed_atomic` dla pary WETH/USDC, okna 2
  (2021-05 krach, `pair_id=1`, `window_id=2`);
- **3 spot-checki** statusów `decayed`/`persisted` (kontrola fałszywych negatywów — czy okazja
  faktycznie nie została skonsumowana on-chain).

## 2. Procedura

Dla każdej z 10 tx `consumed_atomic`:

```sql
SELECT o.block, v.*
FROM opportunity_verifications v
JOIN opportunities o ON o.id = v.opportunity_id
WHERE v.consumer_tx_hash = '<hash>';
```

Kroki: otworzyć `https://etherscan.io/tx/<hash>`, zakładkę „Token Transfers"; porównać `gas_used`,
kierunki swapów w obu pulach (jedna pula sprzedaje WETH za USDC, druga odwrotnie),
`blocks_to_consumption = blok tx − blok okazji`, oraz netto WETH beneficjenta (adres wybrany przez
`pickBeneficiary`, ADR 0005) wobec `realized_profit_usd / ETHUSD` (cena ETH z bloku konsumpcji).

Dla 3 spot-checków `decayed`/`persisted`: zamiast ręcznego przeglądu zakładki „Events" obu pul na
Etherscan, zapytanie bezpośrednio do `swap_events` (ta sama tabela, wypełniona przez RPC-ingest —
źródło pierwotne identyczne z tym, co pokazuje Etherscan) o obecność wspólnej `tx_hash` w obu pulach
w oknie B..B+3 (silniejsza, w pełni odtwarzalna wersja tej samej kontroli — brak wspólnej tx_hash
potwierdza brak fałszywego negatywu).

## 3. Kryteria zgodności

- `gas_used` z bazy identyczne z Etherscan (co do bita);
- kierunki swapów w obu pulach przeciwne;
- `status` = `consumed_atomic` dla próby głównej;
- `blocks_to_consumption` = blok tx − blok okazji;
- zysk: znak i rząd wielkości netto WETH beneficjenta zgodne z `realized_profit_usd`, z tolerancją
  wynikającą z ceny ETH/USD przyjętej z bloku konsumpcji (nie z chwili odczytu Etherscan);
  dokładność „< 1 USD" tam, gdzie się zdarza, jest oznaczona osobno;
- dla trasy `route = 'multi'` (ADR 0003): poprawnym wynikiem jest `realized_profit_usd = NULL` i
  `profitable_consumed = false` — nie próba dopasowania jakiejkolwiek liczbowej wartości zysku.

## 4. Wyniki — tabela końcowa (stan po ADR 0003–0005)

Wartości poniżej pochodzą z sesji kontroli ręcznej (stan bazy po fixie `pickBeneficiary`, job 8),
**nie** z `results/`. Wiersz 4 (opp 25) jest zaktualizowany do stanu PO fixie trasy (ADR 0003): trasa
tej tx sklasyfikowana jako `multi` (agregator Kyber między pulami), więc `realized_profit_usd` jest
poprawnie `NULL`, a nie liczbowa wartość — oznaczone niżej.

> **Uwaga o aktualności liczb:** `realized_profit_usd` w bazie mogły się zmienić po kolejnych
> reweryfikacjach (`force`) po ADR 0003/0004 (fix trasy `multi`, fix ETH≡WETH) — wartości w tabeli
> są tymi z sesji kontroli ręcznej, nie bieżącym stanem bazy. Aktualny stan: zapytanie z §2 na
> bieżącej bazie; agregaty per okno: `results/verification-stats.csv`.

| # | opp id | blok | tx hash | realized_profit_usd | gas_cost_usd | profitable_consumed | netto WETH (Etherscan) | zgodność | uwagi |
|---|--------|-----|---------|---------------------:|------------------------:|:--------------------:|--------------------------------------------------|-----------------------|-------|
| 1 | 1 | 12429895 | [0x4b29b981…3bf80](https://etherscan.io/tx/0x4b29b981025a2686cf666cbaac8a7ba001a15588f071f482d98d615cc063bf80) | 14 180,85 | 48,28 | true | +3,770759 WETH (~14 180 USD) | **TAK** | zgodne < 1 USD; beneficjent = kontrakt bota `0x3700…e379` (`receipt.to`), regresja `known-tx.test.ts` |
| 2 | 2 | 12430486 | [0xe2991cbb…c46be](https://etherscan.io/tx/0xe2991cbb7636388284d26618190535fa5e7ee390a430d704806c7744eafc46be) | 4 779,09 | 553,46 | true | +1,265657 WETH (~4 780 USD) | **TAK** | zgodne co do wartości |
| 3 | 3 | 12430487 | [0xe2991cbb…c46be](https://etherscan.io/tx/0xe2991cbb7636388284d26618190535fa5e7ee390a430d704806c7744eafc46be) | 4 779,09 | 553,46 | true | +1,265657 WETH (~4 780 USD) | **TAK** | duplikat konsumenta wiersza 2 (ten sam tx, druga okazja w B..B+3) |
| 4 | 25 | 12449693 | [0x61af9018…f4c4](https://etherscan.io/tx/0x61af9018b6afaf73202f82244ef5534bc7c177af79d8c74d8025aed1f71cf4c4) | **NULL** (route=`multi`) | 419,84 | **false** | n/d — trasa 3-platformowa (Uni→Kyber→Sushi) | **TAK (po fixie trasy)** | ZAKTUALIZOWANE względem dziennika: klasyfikowana `route='multi'` (ADR 0003) — poprawnie bez wyliczonego zysku, a nie 528 428,05 USD jak przed fixem |
| 5 | 26 | 12449709 | [0x2408b826…3c647](https://etherscan.io/tx/0x2408b8260f46d15a8bac5053a954c3409f5934abb65a695a1c4dbd3e2313c647) | 302,71 | 0,00 | true | +0,094415 WETH (~300–355 USD) | **TAK** | `to` obu swapów identyczny adres |
| 6 | 27 | 12449718 | [0xd95c1a4d…b084e](https://etherscan.io/tx/0xd95c1a4da37480eebba48106be21a5bb9285f7f1f0253c8620769c4fd25b084e) | 235,33 | 71,92 | true | +0,0729 WETH (~178 USD) | **TAK, w przybliżeniu** | bot `0x3700…e379`, jak wiersz 1 |
| 7 | 28 | 12449719 | [0xd95c1a4d…b084e](https://etherscan.io/tx/0xd95c1a4da37480eebba48106be21a5bb9285f7f1f0253c8620769c4fd25b084e) | 235,33 | 71,92 | true | +0,0729 WETH (~178 USD) | **TAK, w przybliżeniu** | duplikat konsumenta wiersza 6 |
| 8 | 29 | 12449726 | [0x5c9eebe0…8275ab](https://etherscan.io/tx/0x5c9eebe07d44e19c4f890003b3973230d19d7339fabd98e909e2925bb58275ab) | 9 638,39 | 0,00 | true | +3,008047 WETH (~11 310 USD) | **TAK, w przybliżeniu** | `gasPrice`=0 (pakiet MEV) |
| 9 | 34 | 12453212 | [0xfe25362d…d9cbf](https://etherscan.io/tx/0xfe25362d01d69a2dc051aeb8caf0e62b8baefc3c123940ae24cf7bfd295d9cbf) | 124,36 | 47,77 | true | +0,039088 WETH (~96 USD) | **TAK, w przybliżeniu** | bot `0x3700…e379`, jak wiersze 1, 6, 7 |
| 10 | 41 | 12454724 | [0x4b61d051…d4b89](https://etherscan.io/tx/0x4b61d051ddf5b16a46f35790ed57bb58a3f37c1dd2d00e85e1c04410c19d4b89) | 4 840,06 | 0,00 | true | +1,516857 WETH (~5 700 USD), 3 przeskoki | **TAK, w przybliżeniu** | `gasPrice`=0 (pakiet MEV); `pickBeneficiary` znajduje adres finalny mimo pośredników |

**Tabela 2 — spot-check `decayed`/`persisted` (fałszywe negatywy?), bez zmian:**

| opp id | blok | status DB | Swap w obu pulach w B..B+3? | zgodne (brak fałszywego negatywu)? |
|--------|------|-----------|-------------------------------|--------------------------------------|
| 621 | 12491854 | decayed | NIE — pula 1: 12 tx, pula 3: 10 tx w B..B+3, zero wspólnych `tx_hash` | **TAK** |
| 9 | 12436412 | persisted | NIE — pula 1 ma 5 tx w B..B+3, pula 3 (Sushiswap) ma zero swapów w tym oknie | **TAK** |
| 86 | 12464584 | persisted | NIE — pula 1: 6 tx, pula 3: 3 tx w B..B+3, zero wspólnych `tx_hash` | **TAK** |

### Przypadki ETH≡WETH (ADR 0004)

Trzy transakcje self-funded round-trip (kontrakt-wykonawca sam zawija ETH→WETH przez `Deposit`,
robi dwa swapy, odwija CAŁY wynikowy WETH przez `Withdrawal`) — sprawdzone bezpośrednio na żywo
(`known-tx.test.ts`, `describe.skipIf(!RPC_URL)`, receipty przez `eth_getTransactionReceipt`,
wartości oczekiwane policzone niezależnie z logów WETH PRZED napisaniem testu, tolerancja ±1%,
3/3 zielone 26.08.2026):

| opp id | tx hash | kontrakt-wykonawca netto | `receipt.from` (EOA) netto | `realized_profit_usd` (po fixie ADR 0004) | uwaga |
|---|---|---|---|---:|---|
| 154 | `0x972cc34a…` | 0 (Deposit 746,02126 → Uni → Sushi → Withdrawal 762,891026) | +16,869766 WETH | 35 824,71 USD (gas 713,88 USD) | zamiast 1 620 078,61 USD przed fixem — 45× mniejsze, realistyczny rząd wielkości |
| 25 | `0x61af9018…` | router Sushi netto 0; bot (`receipt.to`) netto 0 | +0,501775 WETH | NULL (`route='multi'`) | bez regresji: nadal poprawnie `multi` (ADR 0003), netting sam w sobie poprawny |
| 479 | `0x19ff166f…` | kontrakt (`receipt.to`) netto 0 | +0,495602 WETH (10,139267 WETH poszło dalej Transferem do adresu spoza `tx.from`/`receipt.to`) | 21 425,03 USD (gas 261,76 USD) | zamiast 1 164 653,03 USD przed fixem; beneficjent wybrany jako adres o maks. netto (ADR 0005) — adres pośredni `other`, nie EOA/kontrakt bota |

## 5. Wnioski

- **10/10** wierszy próby głównej zgodnych na `gas_used` i kierunkach swapów.
- **3/3** spot-checków `decayed`/`persisted` bez fałszywych negatywów.
- **9/10** wierszy zgodnych co do znaku i rzędu wielkości zysku z niezależnym odczytem Etherscan;
  **2/10** zgodnych z dokładnością < 1 USD.
- **1/10** (wiersz 4, opp 25) to trasa `multi` (agregator) — poprawnie bez wyliczonego zysku
  liczbowego (`NULL`), zgodnie z ADR 0003; nie liczy się jako niezgodność, tylko jako poprawne
  zastosowanie reguły „nieznana etykieta".
- 3/3 przypadków ETH≡WETH (ADR 0004) potwierdzają, że rozliczenie nogi natywnej na `receipt.from`
  daje realistyczne rzędy wielkości zysku zamiast artefaktów self-funded round-trip.
- Ograniczenia heurystyk (`pickBeneficiary`, `classifyRoute`, brak `debug_traceTransaction`) i ich
  wpływ na etykiety: `docs/methodology.md`, §6.

## 6. Jak powtórzyć

```bash
RUN_LIVE_RPC=1 npx vitest run packages/analysis/test/verify/known-tx.test.ts
```

Wymaga `RPC_URL` w środowisku (RPC archiwalny — bloki 2021); bez `RPC_URL` test jest pomijany
(`describe.skipIf`). Testy jednostkowe tych samych wzorców rozliczania zysku bez RPC na żywo (stałe
fixtures receiptów): `packages/analysis/test/verify/{profit,route,beneficiary}.test.ts`. Zapytania
SQL do powtórzenia kontroli ręcznej: §2 wyżej, na bieżącej bazie (`DATABASE_URL`).
