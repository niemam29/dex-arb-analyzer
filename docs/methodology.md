# Metodyka

Dokument opisuje dane, cechy, modele, etykiety i protokół ewaluacji systemu `dex-arb-analyzer`
(praca inżynierska). Decyzje projektowe z uzasadnieniem: `docs/adr/`. Słownik pojęć:
`docs/glossary.md`. Słownik danych (schemat bazy): `docs/data-dictionary.md`. Aktualne liczności
i wyniki: `results/` (generowane przez `npm run export-results`).

## 1. Dane i okna

Sieć: Ethereum mainnet. DEX-y: Uniswap V2 (factory `0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f`) i
Sushiswap (factory `0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac`); obie giełdy mają identyczną
formułę `x·y=k` i identyczne zdarzenia `Sync`/`Swap`, `fee = 30 bps` (`packages/ingest/src/seed-data.ts`
`DEXES`).

Cztery pary logiczne, osiem pul (dwie na parę — Uniswap i Sushiswap), `POOLS` w tym samym pliku:

| Para | DEX | Adres puli | token0 |
|---|---|---|---|
| WETH/USDC | uniswap-v2 | `0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc` | USDC |
| WETH/USDC | sushiswap | `0x397ff1542f962076d0bfe58ea045ffa2d347aca0` | USDC |
| WETH/USDT | uniswap-v2 | `0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852` | WETH |
| WETH/USDT | sushiswap | `0x06da0fd433c1a5d7a4faa01111c044910a184553` | WETH |
| WETH/DAI | uniswap-v2 | `0xa478c2975ab1ea89e8196811f51a7b7ade33eb11` | DAI |
| WETH/DAI | sushiswap | `0xc3d03e4f041fd4cd388c549ee2a29a9e5075882f` | DAI |
| WBTC/WETH | uniswap-v2 | `0xbb2b8038a1640196fbe3e38816f3e67cba72d940` | WBTC |
| WBTC/WETH | sushiswap | `0xceff51756c56ceffca006cd410b03ffc46dd3a58` | WBTC |

Token0/token1 są nadawane przez fabrykę wg porządku adresów, nie wg roli base/quote pary — dla
trzech par (WETH/USDC, WETH/DAI, WBTC/WETH) `token0` jest tokenem kwotowanym (quote), a dla
WETH/USDT jest odwrotnie: `token0 = WETH` (base). To jedyna odwrócona para w zbiorze. Orientację
rezerw na `reserveBase`/`reserveQuote` niezależnie od `token0`/`token1` liczy `orientPool`
(`packages/core/src/orient.ts`), porównując adresy tokenów puli z `pair.tokenBase`/`tokenQuote`.

Cztery okna analizy `[from, to)` w UTC (`WINDOWS`, ten sam plik) i odpowiadające im zakresy bloków
(z brief-u zadania, potwierdzone przy seedowaniu — patrz `resolveWindowBlocks`):

| Okno | Nazwa | Daty UTC [from, to) | Zakres bloków | Liczności |
|---|---|---|---|---|
| 2 | 2021-05 krach | 2021-05-14 – 2021-05-26 | 12 429 199 – 12 506 592 | `results/coverage.csv` |
| 3 | 2021-11 ATH | 2021-11-05 – 2021-11-19 | 13 553 257 – 13 642 393 | `results/coverage.csv` |
| 4 | 2022-05 Luna | 2022-05-05 – 2022-05-19 | 14 713 964 – 14 801 795 | `results/coverage.csv` |
| 5 | 2022-11 FTX | 2022-11-05 – 2022-11-19 | 15 900 096 – 16 000 337 | `results/coverage.csv` |

Numeracja okien (2–5) jest historyczna — okno 1 (zewnętrzny CSV, odrzucony) nie wchodzi do
zbioru tej pracy; patrz niżej i ADR 0001.

Źródło danych jest wyłącznie `eth_getLogs` na zdarzenia `Sync` (topic0
`0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1`) i `Swap`
(topic0 `0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822`), pobierane w chunkach
`LOGS_CHUNK_BLOCKS = 10 000` bloków (`packages/ingest/src/env.ts`), z podziałem chunku na pół, gdy
RPC odrzuca odpowiedź jako zbyt dużą. Zdarzenia są deduplikowane po parze `(block, logIndex)`.
Postęp ingestu jest wznawialny — każdy chunk to wiersz `ingest_ranges` ze statusem
`pending`/`done`/`failed`; przerwany ingest startuje od pierwszego niedokończonego zakresu, nie od
zera.

Backfill metadanych bloku (`eth_getBlockByNumber` z pełnymi transakcjami) daje `timestamp` bloku,
`base_fee` (`NULL` dla bloków sprzed EIP-1559, tj. przed blokiem 12 965 000) oraz
`gas_price_median` = mediana `gasPrice` wszystkich transakcji bloku [wei]. Cena gazu zdarzenia
swapu (`swap_events.gas_price`) to `gasPrice` konkretnej transakcji swapu, nie mediana bloku.

Zewnętrzne dane historyczne (CSV) zostały ODRZUCONE jako źródło (ADR 0001) — 12 004 wierszy
ma pole `logIndex` uszkodzone przepełnieniem `uint32` (wartości rzędu 4 294 967 29x zamiast
realnych indeksów w bloku, które nie przekraczają ~1200); autorytatywnym źródłem dla tych bloków
jest wyłącznie re-ingest RPC tego samego okna/pary.

Analiza pary w danym oknie rusza tylko przy 100% pokryciu obu pul tej pary tym oknem — bramkę
kompletności implementuje `ensureIngestComplete` (`packages/analysis/src/db.ts`): funkcja porównuje
liczbę ukończonych bloków chunków ingestu z liczbą bloków okna i rzuca błąd z listą brakujących
pul, jeśli którakolwiek pula nie osiągnęła 100%.

## 2. Cechy S/G/L/M

Cechy liczone są dla KAŻDEGO bloku okna z rezerw obu pul po ostatnim zdarzeniu `Sync` w bloku
(carry-forward: blok bez zdarzeń dziedziczy rezerwy z poprzedniego). Cena pary to *quote za 1 base*
niezależnie od kolejności `token0/token1` w kontrakcie (`orientPool`, `packages/core/src/orient.ts`):
`p = (reserveQuote / 10^decQuote) / (reserveBase / 10^decBase)`. Definicje (identyczne z implementacją
referencyjną, `packages/core/src/features.ts`):

| Cecha | Wzór | Jednostka | Obcięcie |
|---|---|---|---|
| S — rozbieżność cenowa | `S = |p_A − p_B| / min(p_A, p_B) · 100` | % | `S ≤ S_MAX = 3` |
| G — względny koszt gazu | `G = (ARB_GAS · gasGwei · 10⁻⁹ · ETHUSD) / REF_TRADE_USD · 100` | % wartości tx | `G ≤ G_MAX = 2` |
| L — głębokość płynności | `L = min(TVL_A, TVL_B) / 10⁶`, `TVL = 2 · reserveQuote · quoteUsd` | mln USD | `L ≤ L_MAX = 100` |
| M — ryzyko MEV | `M = 100 · (0,5 · pctl(swapsInBlock) + 0,5 · pctl(gasGwei))` | pkt 0–100 | z definicji |

`ARB_GAS = 220 000` (2 swapy + transfer), `REF_TRADE_USD = 50 000`. Percentyle w M liczone są w
obrębie okna, po wszystkich blokach okna (`percentileRank` — udział wartości ≤ x). `gasGwei` bloku
bez własnych zdarzeń jest interpolowany liniowo między najbliższymi blokami ze zdarzeniami własnych
pul pary (`interpolateLinear`) — próbki gazu są ograniczone do pul analizowanej pary, więc wynik nie
zależy od tego, jakie inne pary zaingestowano w oknie. `ETHUSD` i `quoteUsd`: 1 dla pary kwotowanej
w stablecoinie (USDC/USDT/DAI; wtedy `ETHUSD` = własna cena pary, co wymaga `base = WETH`), a dla
pary kwotowanej w WETH (WBTC/WETH) — kurs referencyjny `price_a` pary WETH/USDC z tego samego okna
i bloku (`stepPrevious`), stąd WETH/USDC musi być przeanalizowana w oknie jako pierwsza. Obcięcia
do dziedzin FIS są stosowane WYŁĄCZNIE w `computeRawFeatures`; modele dostają wartości obcięte.
Obserwacja: dla WETH/USDC `L = 100` w każdym bloku okna 2 (TVL płytszej puli > 100 mln USD) — cecha
L różnicuje dopiero płytsze pary.

Poza cechami blok niesie `gross_profit_usd` i `opt_trade_usd` — zysk brutto i optymalny wolumen
arbitrażu dwupulowego z arytmetyki kontraktu (`optimalTradeIn`, `grossProfit` w
`packages/core/src/amm.ts`, `bigint`, `getAmountOut` jak `UniswapV2Library`), oraz
`baseline_net_profit_usd = gross − ARB_GAS · gasGwei · 10⁻⁹ · ETHUSD`. Blok jest **okazją**, gdy
`S > SPREAD_THRESHOLD_PCT = 0,65 %` (ADR 0002).

## 3. Modele oceny

Cztery modele oceny wykonalności okazji implementują wspólny interfejs `ScoringModel`
(`score(Features) → { score, label, details }`, `score ∈ [0,100]`).

**Baseline v1** (`packages/core/src/baseline.ts`) — próg binarny na zysku netto: `feasible =
opt_trade_usd > 0 ∧ net > 0` (`net = baseline_net_profit_usd`, koszt gazu przy `ARB_GAS = 220 000`),
`roi = net / opt_trade` (gdy `feasible`, inaczej 0), `score = clamp(roi · roiScale, 0, 100)` z
`roiScale = 10 000` (ROI 1 % → 100 pkt). Etykieta baseline v1 NIE korzysta z czteropoziomowej skali
`labelForScore` — jest binarna wprost z `feasible`: `"wykonalna"` gdy `feasible`, w przeciwnym razie
`"niewykonalna"` (`packages/core/src/baseline.ts`, metoda `score`); etykiety `ryzykowna`/`atrakcyjna`
nigdy nie występują dla tego modelu.

**Baseline v2** (`packages/core/src/baselineV2.ts`) — baseline skalibrowany na etykietach
weryfikacji, bez uczenia gradientowego i bez losowości: `net2 = gross − (gasUnits/arbGasRef) ·
gasPriceFactor · gasCostV1` (`arbGasRef = 220 000` = gaz założony w v1), `v = (1−w) ·
σ(net2/scale) + w · rank(optTrade)` ∈ [0,1] (0, gdy `gross ≤ 0`), `score` odcinkowo-liniowe z
`v = threshold ↦ 50` (monotoniczne; `score ≥ 50 ⇔ v ≥ threshold`), etykieta z `labelForScore(score)`
(patrz niżej). Kalibracja przeszukuje siatkę `gasUnits ∈ {150 000, 220 000} × gasPriceFactor ∈
{0; 0,25; 0,5; 0,75; 1} × weightOptTrade ∈ {0; 0,25; 0,5}` (30 kombinacji), `scale = 1,4826 · MAD(net2)`
na zbiorze kalibracyjnym (`robustScale`), próg F1-optymalny (`bestF1Threshold`) na `v`, wybór
punktu siatki maksymalizującego AUC (remis → wyższe F1, dalszy remis → pierwszy w kolejności
siatki) — deterministyczne, bez losowości. Konkretne wybrane parametry tej pracy nie są wpisywane
tu ręcznie — patrz ADR 0006, `results/evaluation.md` oraz `scoring_models.params` (kolumna jsonb,
wypełniona dla `kind = 'baseline_v2'`, serwowana przez `GET /models`) dla wartości aktualnego modelu.

**Mamdani** (`packages/core/src/mamdani.ts`, `mamdani.params.ts`) — cztery wejścia S/G/L/M, każde
z trzema termami (S: znikoma/umiarkowana/duża; G: niski/umiarkowany/zaporowy; L:
płytka/średnia/głęboka; M: niskie/średnie/wysokie), wyjście W z czterema termami
(niewykonalna/ryzykowna/wykonalna/atrakcyjna); AND = min, implikacja = min, agregacja = max,
defuzyfikacja centroidem po 500 próbkach; zaimplementowany na bibliotece `@thi.ng/fuzzy`. 16 reguł
(R1–R3 wetujące — dają `niewykonalna` niezależnie od pozostałych wejść: R1 `S = znikoma`, R2
`G = zaporowy`, R3 `S = umiarkowana ∧ L = płytka`). Parametry termów (ramp/invRamp/triangle) i
kompletna lista reguł R1–R16 pochodzą z implementacji referencyjnej (po dostrojeniu R4/R6/R11/R15) i są zapisane
w `scoring_models.params` — patrz `DEFAULT_MAMDANI_PARAMS` w `mamdani.params.ts`. Etykieta W
(argument `label` wyniku) to term wyjściowy o najwyższej przynależności dla wartości po
defuzyfikacji (`labelForScore`, `pickLabel`) — dla domyślnych parametrów granice (argmax
sąsiednich termów) wypadają w przybliżeniu na `27,5`, `52,5` i `77,5` pkt (obliczone analitycznie z
kształtów `invRamp(15,30)`/`triangle(25,40,55)`/`triangle(50,65,80)`/`ramp(75,90)` i zweryfikowane
numerycznie przez `labelForScore`), nie na okrągłych `25/50/75` — to funkcja ciągła (argmax
przynależności), nie skokowy próg.

**ANFIS** (`packages/core/src/anfis/`) — Takagi–Sugeno rzędu 1, te same 16 reguł co Mamdani.
Przesłanki inicjalizowane z termów Mamdaniego jako Gaussy o tym samym środku i szerokości
połówkowej (`initFromMamdani`, `gaussFromTerm`): trójkąt `(a,b,c)` → `μ=b`, `σ=(c−a)/(4√(2ln2))`;
`invRamp(a,b)` (lewe ramię) → `μ=a`, `σ=(b−a)/(2√(2ln2))`; `ramp(a,b)` (prawe ramię) → `μ=b`,
`σ=(b−a)/(2√(2ln2))`. Klauzule negowane („nie_term") współdzielą (μ,σ) z termem bazowym i liczą
przynależność jako `1−g(x)`, bez osobnego termu Gaussa. Przejście w przód: siła odpalenia reguły to
ILOCZYN przynależności klauzul (nie min — różniczkowalny wszędzie), znormalizowana `w̄ᵢ`,
konsekwenty liniowe na cechach STANDARYZOWANYCH `fᵢ = pᵢS' + qᵢG' + rᵢL' + sᵢM' + tᵢ`
(standaryzator dopasowany WYŁĄCZNIE do zbioru treningowego), wyjście `z = Σw̄ᵢfᵢ`,
`y = σ(z) = 1/(1+e⁻ᶻ)`, `score = 100·y`. Konsekwenty startowe: `p=q=r=s=0`,
`t = logit(center/100)`, gdzie `center` to `μ` termu wyjściowego W przypisanego regule (15/40/65/90
dla parametrów domyślnych) — to daje „miękki centroid" bliski wynikowi Mamdaniego jeszcze przed
treningiem. Etykieta ANFIS pochodzi z DOKŁADNIE TEJ SAMEJ funkcji `labelForScore`, co Mamdani —
ten sam wynik liczbowy score dostaje tę samą etykietę niezależnie od modelu.

Uczenie: Adam (`β₁ = 0,9`, `β₂ = 0,999`, `ε = 1e-8`), `lr = 0,01`, `batch = 256`, `epochs ≤ 200`,
early stopping z `patience = 10` epok bez poprawy straty walidacyjnej, na wewnętrznym podziale
`valFraction = 0,2` — grupowo świadomym, gdy przekazano klucze grup (`splitStratifiedGroups`), w
przeciwnym razie stratyfikowanym po etykiecie (`splitStratified`). Funkcja straty: ważona BCE
(`bceLoss`), wagi `neg = 1`, `pos = min(N_neg/N_pos, MAX_CLASS_WEIGHT_RATIO = 50)`. Dolne
ograniczenie `σ ≥ 0,01 · (domain_hi − domain_lo)` (1 % szerokości dziedziny zmiennej) wymuszane po
każdym kroku Adama. Determinizm: cały stan pseudolosowy (podział, tasowanie minibatchy) pochodzi z
jednego generatora `mulberry32(seed)` — ten sam seed i dane dają identyczne wytrenowane parametry.
Zbiór uczący: zweryfikowane okazje o znanej etykiecie w całości plus tło (bloki bez okazji)
podpróbkowane w stosunku `10 : 1` (`NEGATIVES_PER_POSITIVE`, `buildDataset` w `@dex-arb/analysis`).

## 4. Etykiety (weryfikacja retrospektywna)

Każda okazja (blok z `S > 0,65 %`) jest śledzona w oknie `B..B+K_MAX` (`K_MAX = 3` bloki,
`packages/analysis/src/verify/classify.ts`) i klasyfikowana na jeden z czterech statusów:

- **`consumed_atomic`** — istnieje kandydat: pierwsza (wg `block, logIndex`) transakcja w
  `B..B+K_MAX` zawierająca zdarzenia `Swap` w OBU pulach pary o przeciwnych kierunkach
  (`pickCandidate`/`findAtomicCandidates`), z udanym receiptem (`status = 1`). Okazja BYŁA
  skonsumowana atomowo w jednej transakcji.
- **`consumed_partial`** — spread spadł poniżej progu w bloku `B+k`, a w tym samym bloku istnieje
  swap zawężający spread w droższej puli, ale nie spełniający kryteriów atomowego arbitrażu
  dwupulowego (`findPartialConsumer`).
- **`decayed`** — spread spadł poniżej progu w `B+k` bez identyfikowalnej konsumującej transakcji
  (naturalny powrót ceny, arbitraż poza analizowaną parą, inny mechanizm).
  `blocks_to_consumption = k`.
- **`persisted`** — spread pozostał powyżej progu we WSZYSTKICH blokach `B..B+K_MAX`; brak
  rozstrzygnięcia w horyzoncie obserwacji.

**Trasa (`route`, ADR 0003)** — dla `consumed_atomic` klasyfikowana jako `two_pool` albo `multi`
(`classifyRoute`, `packages/analysis/src/verify/route.ts`): `two_pool` oznacza, że receipt zawiera
WYŁĄCZNIE zdarzenia `Swap` V2 dwóch pul analizowanej pary — żadnego obcego `Swap` V2 (trzecia
pula), żadnego `Swap` V3/innego DEX-u, żadnego `Transfer` tokena spoza pary (wrap/unwrap WETH przez
`Withdrawal`/`Deposit` jest dozwolony — to nie „obcy token", tylko natywna otoczka rozliczana przez
`decodeWethNativeTransfers`). Gdy którykolwiek z tych warunków jest naruszony, trasa to `multi` —
transakcja dotyka trzeciej puli/DEX-u lub przenosi token spoza pary, więc netto dwóch tokenów pary
nie jest wiarygodnym zyskiem konsumenta (może to być tylko jeden leg wielohopowego handlu kogoś
innego). Dla `route = multi`: `realized_profit_usd = NULL`, etykieta klasyfikacji binarnej
NIEOKREŚLONA — wiersz jest WYKLUCZONY z populacji uczenia/ewaluacji (wymuszone CHECK bazy `NOT
(route = 'multi' AND profitable_consumed)`, migracja `0005_verification_route`); `gas_cost_usd`
pozostaje policzony (koszt gazu tej transakcji jest wiarygodny niezależnie od trasy), a status
pozostaje `consumed_atomic` (okazja BYŁA skonsumowana — nieznany jest tylko realny zysk konsumenta).

**Beneficjent** (ADR 0005) — adres o maksymalnym netto USD przepływów tokenów pary spośród
kandydatów (`to` obu swapów, `tx.from`, kontrakt wywołany `tx.to`, każdy odbiorca `Transfer` tokena
pary poza pulami), z rangą tie-break `receipt.to` > `tx.from` > pozostałe (`pickBeneficiary`,
`packages/analysis/src/verify/profit.ts`). **ETH ≡ WETH** (ADR 0004) — unwrap/wrap WETH nie emituje
`Transfer`, więc `Withdrawal`/`Deposit` są dekodowane na syntetyczne przepływy WETH przypisane
zawsze `receipt.from` (`decodeWethNativeTransfers`), żeby router unwrapujący WETH i przekazujący
wynikowy natywny ETH dalej (poza logami) nie wyglądał fałszywie jak beneficjent całej kwoty.

`gas_cost_usd = gasUsed · effectiveGasPrice · ETHUSD` (cena ETH z bloku konsumpcji).

**`profitable_consumed = (status = consumed_atomic) ∧ (route = two_pool) ∧ (realized_profit_usd −
gas_cost_usd > 0)`** — to jest etykieta binarna klasyfikacji użyta w protokole ewaluacji (sekcja 5).

`blocks_to_consumption = blok tx konsumującej − blok okazji ∈ [0, 3]`. Uwaga: `k = 0` oznacza, że
konsumpcja nastąpiła w TYM SAMYM bloku co okazja — stan bloku (`block_states`, spread) jest stanem
NA KONIEC bloku, więc okazja i jej konsumpcja mogą dzielić numer bloku bez sprzeczności
przyczynowej (konsumująca tx jest wcześniej w kolejności bloku niż zdarzenie `Sync`, które ustaliło
zaobserwowany spread — a i tak może istnieć niezależnie od kolejności logów w tym samym bloku).
Dostępna jest opcja wykluczenia takich wierszy z populacji (`excludeK0`) dla analiz wrażliwości.

## 5. Protokół ewaluacji

**Populacje (ADR 0008).** Wszystkie metryki porównawcze liczone są na populacji *zweryfikowanych
okazji o znanej etykiecie*: `opportunity_verifications ⋈ opportunities`, `route IS NULL OR route <>
'multi'`, wszystkie pary okna; wynik modelu z `model_scores` po `(pair_id, block)`; okazje bez wyniku
modelu (model nie oceniał tego okna) są wykluczone i raportowane przez `n`. Osobno, wyłącznie
diagnostycznie, zapisywana jest populacja `block_states` (wszystkie bloki okna, tło = klasa 0),
na której odróżnienie „okazja vs brak okazji" jest trywialne (AUC ≈ 0,99) — te liczby nie służą
do porównań modeli. Obie populacje trafiają do `scoring_models.metrics` (`population_verified`,
`population_block_states`) razem z blokiem `provenance` (git SHA, wersje bibliotek, host RPC,
zakresy bloków i liczności okien w chwili treningu).

**Podział train/test.** Międzyoknowy: trening na oknie 2 (2021-05), test na 3+4+5; wariant
cross-regime: trening 2+4, test 3+5. Gdy `test_windows` nie podano, 20 % grup chronologicznie
(ADR 0007): grupa = wszystkie okazje dzielące tę samą tx konsumującą (`consumer_tx_hash`), a dla
okazji bez tx — klaster sąsiednich okazji tej samej pary i okna (przerwa ≤ `BLOCK_CLUSTER_GAP_MAX =
3` bloki); tło to singletony. Ten sam podział grupowy działa wewnątrz treningu ANFIS (walidacja do
early stoppingu). Standaryzator i podpróbkowanie tła są dopasowywane wyłącznie do części treningowej.

**Próg i metryki.** Klasyfikacja binarna przy stałym progu `score ≥ 50` dla każdego modelu; z niego
macierz pomyłek, precision, recall, F1. Baseline v2 ma próg dobrany na etykietach (F1-optymalny na
oknie kalibracji, zmapowany na 50), pozostałe modele — próg stały; dlatego tabela główna traktuje
**AUC i PR-AUC (metryki niezależne od progu) jako podstawowe**, a F1 jako pomocnicze, i dodatkowo
raportuje `threshold_train_opt` — próg F1-optymalny wyznaczony dla KAŻDEGO modelu tym samym
algorytmem (`thresholdOptF1`) na jego oknach treningowych (ADR 0006). AUC = statystyka
Mann–Whitneya z remisami po 0,5 (`rocAuc`); PR-AUC = average precision z interpolacją krokową
(`averagePrecision`), właściwa przy 1–12 % pozytywów.

**Niepewność.** 95 % przedział ufności AUC z bootstrapu stratyfikowanego po klasie (1000 prób,
`mulberry32(42)`, percentyle 2,5/97,5; `bootstrapAucCi`). Przy `n_pos = 7` (okno 5) przedział jest
szeroki z konstrukcji i wyniki tego okna interpretujemy jako anegdotyczne. Stabilność ANFIS względem
inicjalizacji/tasowania: 5 seedów (42–46) dla każdej konfiguracji, raportowane mean ± sd AUC i
PR-AUC (`results/evaluation-seeds.csv`).

**Odtwarzalność.** Wszystkie liczby w `docs/` pochodzą z `npm run export-results` (te same funkcje
co `GET /models/:id/evaluation`); pełny przebieg od pustej bazy: `scripts/reproduce.sh`.

**Wrażliwość na definicję populacji.** `results/evaluation-sensitivity.{csv,md,tex}` (`npm run
export-results -- --sensitivity-only [--latex]`, bez nadpisywania pozostałych plików `results/`)
powtarza metryki tabeli głównej dla modeli 1, 2, 47, 49, 48 na trzech populacjach
(`PopulationVariant`, `packages/api/src/queries/evaluation.sql.ts`): `full` (referencyjna, jak wyżej),
`exclude_k0` (bez konsumpcji atomowych z `k = 0`, odpowiednik `excludeK0` z §4 — ale na populacji
ewaluacji, nie tylko treningu ANFIS) i `bot_first` (z konsumpcji `two_pool` zostają tylko te z `k ≥ 1`,
w których tx konsumująca była pierwszym swapem bloku `B+k` w pulach pary; pozostałe konsumpcje
`two_pool` są wykluczone jako etykieta nieokreślona, negatywy bez zmian). Definicje są zapisane w
nagłówku pliku `.md`.

## 6. Ograniczenia i założenia

a. **Finalność bloków.** Logi ze znacznikiem `removed = true` są pomijane przy dekodowaniu
   (`decodeLog`), ale baza nie ma osobnej obsługi reorgów (usuwania/cofania już zapisanych
   wierszy). Analizowane okna pochodzą z 2021–2022, są więc dawno finalne — założenie jest
   bezpieczne dla tej pracy, ale niewystarczające dla ingestu danych na żywo blisko czoła
   łańcucha.

b. **Interpolacja gazu.** Tabela `blocks` niesie metadane tylko dla bloków z co najmniej jednym
   zdarzeniem analizowanej pary — cena gazu bloków pomiędzy jest interpolowana liniowo
   (`interpolateLinear`). Przed EIP-1559 (okno 2, przed blokiem 12 965 000) koszt gazu liczony jest
   z `gasPrice` transakcji; po EIP-1559 — z `effectiveGasPrice`.

c. **Pakiety MEV z zerowym gazem.** Część transakcji `consumed_atomic` (widoczna np. w oknie 2) ma
   `gasPrice = 0` — typowy ślad pakietu Flashbots dostarczonego bezpośrednio budowniczemu bloku, z
   opłatą poza polem `gasPrice` transakcji. Dla takich wierszy `gas_cost_usd = 0`; dokładna liczba
   per okno × para w kolumnie `zero_gas_consumers` w `results/verification-stats.csv`.

d. **Trasy wielopulowe.** Konsumpcje przez agregatory i Uniswap V3 są klasyfikowane jako
   `route = multi` i mają nieznaną etykietę (wykluczone z populacji uczenia/ewaluacji) — w oknie 2
   to ok. 20 % `consumed_atomic`; dokładnie w `results/verification-stats.csv`.

e. **Zakres wykrywania.** System wykrywa wyłącznie atomowy arbitraż dwupulowy Uniswap ↔ Sushiswap w
   jednej transakcji; arbitraż trójkątny, cross-DEX z więcej niż dwiema pulami czy across-chain jest
   poza zakresem.

f. **Precyzja liczbowa.** Rezerwy i kwoty tokenów są przechowywane jako `numeric(40,0)` i liczone w
   TypeScript jako `bigint`; cała arytmetyka AMM (`getAmountOut`, `optimalTradeIn`, `grossProfit`)
   działa na `bigint`. Konwersja do `double` (`Number(reserve)`) zachodzi wyłącznie przy wycenie w
   USD — dla rezerw rzędu 1e23 błąd względny reprezentacji IEEE-754 double (mantysa 53 bity) jest
   ≤ 2⁻⁵², nieistotny wobec precyzji cen/USD; pokrycie testem `packages/core/test/amm.test.ts`.

g. **Czas.** Wszystkie znaczniki czasu w bazie są `timestamptz`; okna analizy są definiowane w UTC,
   a interfejs wyświetla daty w UTC.

h. **Jeden worker.** Kolejka jobów ma jednego workera bez timeoutu ani heartbeatu — zawieszony job
   blokuje kolejkę bez automatycznego wykrycia. Dopuszczalne dla aplikacji lokalnej tej pracy;
   pozycja w dalszych pracach.

i. **Heurystyki klasyfikacji.** Wybór beneficjenta i trasy (`route`) to heurystyki na logach
   receiptu — ich błędy przenoszą się wprost na etykiety klasyfikacji binarnej. Kontrola ręczna
   wybranej próbki transakcji (10 + 3 spot-checki) jest udokumentowana w
   `docs/verification-method.md`.

## 7. Migracje schematu

Polityka: zmiana schematu zaczyna się od edycji Drizzle ORM i `npm run db:generate`, wygenerowany
SQL jest przeglądany ręcznie, dopuszczalna jest ręczna edycja pliku migracji (np. dopisanie
backfillu danych, komentarzy `COMMENT ON COLUMN`) przed uruchomieniem. Migracji w dół nie ma — baza
jest w całości odtwarzalna od zera z RPC (`scripts/reproduce.sh`), więc cofnięcie schematu oznacza
odtworzenie bazy, nie migrację `down`.

Lista migracji (`packages/db/drizzle/`):

- **`0000_woozy_korath`** — schemat bazowy: `dexes`, `tokens`, `pairs`, `pools`, `windows`,
  `blocks`, `sync_events`, `swap_events`, `ingest_ranges`, `jobs`, `block_states`, `opportunities`,
  `opportunity_verifications`, `scoring_models`, `model_scores`.
- **`0001_perfect_mach_iv`** — klucz główny `ingest_ranges` rozszerzony z `(pool_id, from_block)` na
  `(pool_id, from_block, to_block)` (pozwala na więcej niż jeden zakres zaczynający się od tego
  samego bloku), dodana kolumna `jobs.error` (text) i unikalny indeks
  `opportunities (pair_id, block)`.
- **`0002_shocking_nico_minoru`** — nowy typ enum `direction_kind` (`none`/`a_to_b`/`b_to_a`) dla
  `block_states.direction`/`opportunities.direction`, typ enum `feasibility_label` dla
  `model_scores.label`, UNIQUE `(name, version)` na `scoring_models`, komentarze kolumn dot.
  jednostek `gas_price_median` (GWEI w `block_states`, WEI w `blocks`).
- **`0003_sudden_retro_girl`** — częściowy indeks unikalny `jobs (type, params) WHERE status IN
  ('queued','running')` — zapobiega zdublowaniu tego samego joba w kolejce.
- **`0004_talented_omega_flight`** — klucz obcy `opportunity_verifications.opportunity_id` dostaje
  `ON DELETE CASCADE`.
- **`0005_verification_route`** — nowy typ enum `verification_route` (`two_pool`/`multi`), kolumna
  `opportunity_verifications.route` z backfillem z dawnego proxy (`status = 'consumed_atomic' AND
  realized_profit_usd IS NULL` ⇒ `multi`), oraz dwa CHECK-i: `route IS NULL OR status =
  'consumed_atomic'` i `NOT (route = 'multi' AND profitable_consumed)`.
- **`0006_baseline_v2_kind`** — `ALTER TYPE ... ADD VALUE` (poza transakcją, więc kolejne migracje w
  tym samym uruchomieniu nie mogą jeszcze użyć nowej wartości) dodaje `model_kind.baseline_v2` i
  `job_type.calibrate:baseline_v2`.
- **`0007_invariants`** — CHECK-i zakresów wartości (`block_states`, `model_scores.score`,
  `jobs.progress`, `ingest_ranges`, `windows`, `pairs`, `pools`, `opportunities`,
  `opportunity_verifications`) — patrz `docs/data-dictionary.md`.
- **`0008_column_comments`** — `COMMENT ON COLUMN` dla kolumn niosących jednostki (WEI/GWEI/USD/%)
  — patrz `docs/data-dictionary.md`.

## 8. Stan danych

Aktualne liczności tabel, pokrycie okien i wyniki: `results/provenance.json` i `results/evaluation.md`.
