# Glosariusz

Hasła alfabetycznie. Format: **hasło** (ang. *term*) — definicja, odsyłacz do kodu/ADR. Pełne
definicje wzorów i protokołu: `docs/methodology.md`.

**agregator** (ang. *aggregator*) — kontrakt routera (np. 1inch, Uniswap Router), który dzieli
handel usera na wiele pul/DEX-ów w jednej transakcji. Transakcja dotykająca trzeciej puli poza
analizowaną parą jest klasyfikowana jako `route = multi` i wykluczona z populacji etykiet
(`packages/analysis/src/verify/route.ts`, ADR 0003).

**AMM x·y=k** (ang. *constant-product AMM*) — market maker działający wg niezmiennika iloczynu
rezerw `reserve0 · reserve1 = k` (Uniswap V2/Sushiswap V2); cena wynika z proporcji rezerw, opłata
(30 bps) jest potrącana z wpłacanego tokenu przed przeliczeniem. Arytmetyka `getAmountOut` w
`packages/core/src/amm.ts`.

**arbitraż atomowy** (ang. *atomic arbitrage*) — arbitraż wykonany w JEDNEJ transakcji (dwa swapy
przeciwnych kierunków w obu pulach pary), więc albo cała sekwencja się powiedzie, albo cała się
cofnie — brak ryzyka pozostania z połową pozycji. Status `consumed_atomic`
(`packages/analysis/src/verify/classify.ts`).

**AUC ROC** (ang. *area under the ROC curve*) — prawdopodobieństwo, że model przypisze wyższy
score losowej okazji pozytywnej niż losowej negatywnej; liczone jako statystyka Mann–Whitneya po
rangach z remisami po 0,5 (`rocAuc`, `packages/core/src/evaluation.ts`). Metryka niezależna od
progu klasyfikacji — podstawowa w protokole ewaluacji (`docs/methodology.md`, §5).

**average precision / PR-AUC** (ang. *precision-recall AUC*) — pole pod krzywą precyzja-czułość z
interpolacją krokową; przy silnie niezbalansowanych klasach (tu 1–12 % pozytywów) czulsza od
AUC ROC na fałszywe pozytywy. Uzupełnia AUC w tabeli głównej protokołu ewaluacji.

**backfill** (ang. *backfill*) — dociągnięcie metadanych bloku (`timestamp`, `base_fee`,
`gas_price_median`) przez `eth_getBlockByNumber` osobno od ingestu logów zdarzeń.

**baseline v1/v2** (ang. *baseline v1/v2*) — modele odniesienia bez logiki rozmytej. v1: prosty
próg na zysku netto przy założeniu 220k gazu (`packages/core/src/baseline.ts`). v2: baseline
skalibrowany na etykietach weryfikacji (koszt gazu i waga rangi optymalnego wolumenu dobrane
siatką, bez losowości) — `packages/core/src/baselineV2.ts`, ADR 0006.

**beneficjent** (ang. *beneficiary*) — adres, który realnie zyskał na konsumpcji okazji: spośród
kandydatów (odbiorcy swapów, `tx.from`, kontrakt wywołany, odbiorcy `Transfer` tokenów pary) wybrany
jest ten o maksymalnym netto USD (`pickBeneficiary`, ADR 0005).

**blok konsumpcji / `blocks_to_consumption`** — numer bloku transakcji, która skonsumowała okazję,
liczony jako opóźnienie względem bloku okazji, `∈ [0, K_MAX] = [0, 3]`. `k = 0` jest dopuszczalne:
stan bloku (spread) opisuje jego koniec, więc okazja i jej konsumpcja mogą dzielić numer bloku.

**bootstrap stratyfikowany** (ang. *stratified bootstrap*) — metoda estymacji niepewności AUC:
1000 losowań próby ze zwracaniem, oddzielnie w obrębie klasy pozytywnej i negatywnej, z jednego
generatora `mulberry32(42)`; przedział ufności 95 % to percentyle 2,5/97,5 rozkładu AUC
(`bootstrapAucCi`).

**chunk ingestu / `ingest_ranges`** — pojedyncze zapytanie `eth_getLogs` o `LOGS_CHUNK_BLOCKS =
10 000` bloków; każdy chunk to wiersz `ingest_ranges` ze statusem `pending`/`done`/`failed`, co
czyni ingest wznawialnym po przerwaniu.

**`consumed_atomic` / `consumed_partial` / `decayed` / `persisted`** — cztery statusy klasyfikacji
okazji w oknie `B..B+K_MAX`: atomowa konsumpcja jedną transakcją / częściowa konsumpcja bez
kryteriów atomowości / naturalny zanik spreadu bez zidentyfikowanej tx / spread utrzymał się we
wszystkich `K_MAX` blokach (`classify`, `packages/analysis/src/verify/classify.ts`).

**defuzyfikacja centroidem** (ang. *centroid defuzzification*) — zamiana rozmytego wyniku
agregacji reguł na liczbę ostrą: środek ciężkości pola pod funkcją przynależności wyjścia, liczony
numerycznie na 500 próbkach domeny (`@thi.ng/fuzzy`, `mamdani.params.ts` pole `samples`).

**EIP-1559 / baseFee / effectiveGasPrice** — zmiana rynku gazu Ethereum od bloku 12 965 000: przed
nią koszt tx liczy się z `gasPrice` transakcji, po niej z `effectiveGasPrice` (suma `baseFee` bloku
i priorytetu). Okno 2 (maj 2021) jest w całości sprzed EIP-1559.

**early stopping** — zatrzymanie treningu ANFIS, gdy strata walidacyjna nie poprawia się przez
`patience = 10` kolejnych epok; zwracane są parametry z epoki o najniższej stracie walidacyjnej
(`trainAnfis`, `packages/core/src/anfis/train.ts`).

**Flashbots bundle (pakiet MEV, `gasPrice = 0`)** — transakcja dostarczona bezpośrednio
budowniczemu bloku poza publicznym mempoolem, z opłatą przekazaną poza polem `gasPrice`; w danych
widoczna jako `consumed_atomic` z `gasPrice = 0` i `gas_cost_usd = 0` (§6 metodyki, punkt c).

**grupa podziału** (ang. *group-aware split*) — jednostka podziału train/test większa niż
pojedynczy wiersz: wszystkie okazje dzielące tę samą `consumer_tx_hash`, albo — bez tx — klaster
sąsiednich okazji tej samej pary/okna w odstępie ≤ `BLOCK_CLUSTER_GAP_MAX = 3` bloki. Zapobiega
wyciekowi informacji między train i val/test (ADR 0007, `splitStratifiedGroups`).

**holdout** — część danych odłożona wyłącznie do oceny (test), nieużywana przy dopasowaniu
standaryzatora, kalibracji siatki baseline v2 ani treningu ANFIS.

**klaster okazji (`BLOCK_CLUSTER_GAP_MAX`)** — grupa sąsiednich okazji tej samej pary w tym samym
oknie, oddzielonych przerwą ≤ 3 bloki, traktowana jako jedna jednostka podziału train/test (stała
`BLOCK_CLUSTER_GAP_MAX = 3`, `packages/core/src/constants.ts`).

**Mamdani (FIS)** (ang. *Mamdani fuzzy inference system*) — rozmyty system wnioskowania: AND = min,
implikacja = min, agregacja = max, defuzyfikacja centroidem; cztery wejścia S/G/L/M, wyjście W,
16 reguł. `packages/core/src/mamdani.ts` (biblioteka `@thi.ng/fuzzy`).

**MEV** (ang. *maximal extractable value*) — wartość możliwa do wydobycia z kolejności/doboru
transakcji w bloku (tu: arbitraż DEX). Cecha M szacuje ryzyko konkurencji o okazję (aktywność
botów + percentyl ceny gazu).

**okazja** (ang. *opportunity*, `S > 0,65 %`) — blok, w którym rozbieżność cenowa między pulami
przekracza próg `SPREAD_THRESHOLD_PCT = 0,65 %` (suma prowizji 2 × 0,3 % obu wymian V2); wiersz
tabeli `opportunities`, ADR 0002.

**okno** (ang. *window*) — zakres bloków `[from, to)` w UTC odpowiadający jednemu historycznemu
reżimowi rynkowemu (np. „2021-05 krach"); definicja w `packages/ingest/src/seed-data.ts` `WINDOWS`.

**populacja ewaluacji** (ang. *evaluation population*) — zbiór wierszy, na których liczone są
metryki porównawcze: zweryfikowane okazje o znanej etykiecie (`route ≠ multi`) z wynikiem modelu;
osobno, wyłącznie diagnostycznie, populacja `block_states` (wszystkie bloki, tło = klasa 0) — ADR 0008.

**proweniencja** (ang. *provenance*) — metadane odtwarzalności zapisane przy treningu/kalibracji
modelu: SHA commita, wersje bibliotek, host RPC, zakresy bloków i liczności okien w chwili treningu
(`scoring_models.metrics`, `results/provenance.json`).

**reżim rynkowy** (ang. *market regime*) — jeden z czterech historycznych okresów wysokiej
zmienności użytych jako okna analizy: krach 05/2021, ATH 11/2021, załamanie Luna 05/2022, upadek
FTX 11/2022.

**rezerwy / `Sync`** — stan puli AMM (`reserve0`, `reserve1`) po ostatnim zdarzeniu `Sync` w
bloku; blok bez własnych zdarzeń dziedziczy rezerwy poprzedniego (carry-forward), §2 metodyki.

**route `two_pool`/`multi`** — klasyfikacja trasy transakcji konsumującej okazję: `two_pool` = tx
dotyka wyłącznie dwóch pul analizowanej pary (zysk policzalny), `multi` = tx dotyka trzeciej
puli/DEX-u lub przenosi token spoza pary (zysk niepoliczalny, etykieta NULL). ADR 0003,
`classifyRoute`.

**seed (`mulberry32`)** — generator liczb pseudolosowych o jawnym stanie startowym (seed), z
którego pochodzi CAŁY pseudolosowy przebieg treningu ANFIS (podział, tasowanie) —
ten sam seed + te same dane = identyczne wytrenowane parametry (`packages/core/src/anfis/random.ts`).

**spread** (pol. rozbieżność cenowa, cecha S) — `|p_A − p_B| / min(p_A, p_B) · 100` [%], różnica
cen tej samej pary między dwiema pulami; wejście FIS obcięte do `S_MAX = 3 %`
(`packages/core/src/features.ts`).

**Takagi–Sugeno (ANFIS)** — wariant systemu rozmytego, w którym konkluzja każdej reguły jest
funkcją liniową wejść (rzędu 1: `p·S + q·G + r·L + s·M + t`), nie termem rozmytym jak w Mamdanim;
parametry przesłanek i konkluzji są uczone gradientowo. `packages/core/src/anfis/`.

**tło** (ang. *background*, bloki bez okazji) — bloki okna z `S ≤ 0,65 %`, klasa negatywna (0) w
zbiorze uczącym ANFIS i w populacji diagnostycznej `block_states`; ponad 99 % wszystkich bloków, w
zbiorze uczącym podpróbkowane `10 : 1` względem pozytywów (`NEGATIVES_PER_POSITIVE`).

**TVL** (ang. *total value locked*) — wartość zablokowana w puli w USD; cecha L = TVL płytszej z
dwóch pul pary, `TVL = 2 · reserveQuote · quoteUsd`, obcięta do `L_MAX = 100` mln USD.

**ważona BCE** (ang. *class-weighted binary cross-entropy*) — funkcja straty treningu ANFIS: strata
klasy pozytywnej mnożona przez `pos = min(N_neg/N_pos, 50)`, klasy negatywnej przez `neg = 1` —
kompensuje silną niezbalansowanie klas (`bceLoss`, `MAX_CLASS_WEIGHT_RATIO`).

**WETH ≡ ETH (wrap/unwrap)** — natywny ETH i opakowany WETH są traktowane jako jeden aktyw:
`Withdrawal`/`Deposit` (które nie emitują `Transfer`) są dekodowane na syntetyczne przepływy WETH
przypisane `receipt.from` (`decodeWethNativeTransfers`, ADR 0004).

**zysk brutto/netto/zrealizowany** (`gross_profit_usd`, `baseline_net_profit_usd`,
`realized_profit_usd`) — brutto: wynik arytmetyki AMM bez kosztu gazu, przy optymalnym wolumenie
(`grossProfit`, `packages/core/src/amm.ts`); netto (baseline v1): brutto minus koszt gazu przy
założeniu 220k gazu; zrealizowany: rzeczywisty przepływ netto tokenów pary do beneficjenta,
wyceniony po cenach z bloku konsumpcji (`realizedProfit`, `packages/analysis/src/verify/profit.ts`),
tylko dla `route = two_pool`.
