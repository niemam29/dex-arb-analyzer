# Etap 6 — ANFIS i widok Modele

> Stan: 27.08.2026, 04:57 UTC (`results/provenance.json`). Tabele wyników generowane skryptem —
> patrz „Proweniencja".

## Czym jest ANFIS w tym systemie
Trzeci model oceny wykonalności (obok deterministycznego baseline'u i FIS Mamdaniego), uczony na etykietach z weryfikacji retrospektywnej (`opportunity_verifications.profitable_consumed`).

- **Architektura:** Takagi–Sugeno rzędu 1 (`packages/core/src/anfis`). Przesłanki — gaussowskie
  funkcje przynależności inicjalizowane z termów Mamdaniego (`initFromMamdani`, `gaussFromTerm`;
  trapezy → gaussy o tej samej środkowej/szerokości, ramiona jako „shoulder"), konkluzje
  liniowe f_i(S,G,L,M) inicjalizowane logitem centroidów wyjścia (15/40/65/90).
- **Wnioskowanie:** siła odpalenia reguły = iloczyn przynależności, normalizacja w̄_i = w_i/Σw,
  z = Σ w̄_i·f_i, **y = sigmoid(z)**, score = 100·y (ta sama skala 0–100 i etykiety co Mamdani).
- **Uczenie:** Adam na wszystkich parametrach (μ, σ, współczynniki konkluzji), **ważona BCE**
  (wagi klas „balanced", odwrotnie do liczności, z ograniczeniem), minibatch 256, early stopping
  po stracie walidacyjnej (patience 10) na wewnętrznym, **grupowo świadomym** podziale train/val
  (`splitStratifiedGroups`; grupa = okazje dzielące tę samą tx konsumującą / klaster bloków —
  bez tego sąsiednie, niemal identyczne przykłady przeciekałyby do walidacji).
- **Dane:** `buildDataset` (`packages/analysis/src/anfis/dataset.ts`) — cechy S/G/L/M z
  `block_states`, podpróbkowane tło (bloki bez okazji) jako klasa 0. Podział czasowy: trening na
  oknie 2 („2021-05 krach"), test na oknach 3–5 (wariant cross-regime: trening 2+4, test 3+5); przy braku `test_windows` worker robi
  chronologiczne odcięcie 20 % zbioru uczącego, także z zachowaniem grup (`splitTrainTestByTime`).
  Wiersze o **nieznanej etykiecie** (`route = 'multi'` — konsumpcja przez agregator, zysk
  nieznany) są **pomijane**, nie liczone jako negatywy — spójnie w treningu, ewaluacji i API.

## Uruchomienie
Przez API (zadanie kolejki `train`, wykonuje worker `npm run start -w @dex-arb/worker`):
```bash
curl -X POST localhost:3001/models/anfis/train -H 'content-type: application/json' \
  -d '{"train_windows":[2],"test_windows":[3],"seed":42,"epochs":200,"lr":0.01,"exclude_k0":false,"name":"anfis"}'
```
Wszystkie pola poza `train_windows` są opcjonalne (domyślne: seed 42, 200 epok, lr 0,01,
`exclude_k0=false`; `name` domyślnie `anfis` z kolejną wersją). Odpowiedź 201 = utworzone zadanie,
409 = takie zadanie już czeka/trwa.

Odczyt:
- `GET /models` — lista modeli (dla ANFIS dodatkowo `training_metrics_summary` z jawnym polem
  `population` — domyślnie `"verified_opportunities"` (`metricsSummaryFrom`,
  `packages/api/src/anfisMetrics.ts`, ADR 0008); starsze modele 13–15, zapisane przed wprowadzeniem
  bloku `population_verified`, wracają do `population: "block_states"` — patrz uwaga niżej),
- `GET /models/:id/evaluation?window=<id>` — metryki na zweryfikowanych okazjach danego okna
  (bez `window` — wszystkie okna): `n`, `n_positive`, `confusion` (próg 50), precision/recall/F1,
  `auc`, `auc_ci95` (95 % CI, bootstrap), `pr_auc`, ROC, histogram score, `threshold_train_opt`;
  dla ANFIS także `class_weights`, `history`, `trained_on_window_ids`.
- Dashboard: widok **Modele** (`/modele`) — formularz treningu, lista modeli, krzywe ROC,
  histogramy, macierz pomyłek i historia straty.

## Dane po pełnej macierzy 4 pary × 4 okna
64 zadania (8 pul × 4 okna ingest + 16 analyze + 16 verify — `planMatrix`,
`packages/worker/src/matrix/plan.ts`; patrz `results/jobs-stats.csv`) dla par WETH/USDC, WETH/USDT,
WETH/DAI, WBTC/WETH × okien 2–5 wykonane. Łącznie **1 418 144 `block_states`**, **4 829 okazji**
(liczności bieżące: patrz sekcja
„Proweniencja").

| Okno | okazje | consumed_atomic two_pool / multi | profitable |
|---|---|---|---|
| 2021-05 krach | 2236 | 500 / 118 | 477 |
| 2021-11 ATH | 891 | 20 / 5 | 20 |
| 2022-05 Luna | 1296 | 43 / 17 | 40 |
| 2022-11 FTX | 406 | 7 / 4 | 7 |

Klasa dodatnia (`profitable_consumed`) poza oknem 2021-05 krach jest bardzo mała: 20 / 40 / 7
pozytywów.

Źródło: `results/verification-stats.csv` (mediany zysku per para tamże), `results/coverage.csv`
(block_states per para × okno) — `npm run export-results`.

## Porównanie modeli

Tabela poniżej jest WKLEJKĄ `results/evaluation.md` wygenerowaną przez `npm run export-results`
(te same funkcje co `GET /models/:id/evaluation`; metodyka: `docs/methodology.md` §5). Nie edytować
ręcznie — regenerować skryptem. Identyfikatory modeli: baseline (1), Mamdani (2), baseline_v2
(najnowsza wersja), ANFIS `anfis-w2` (trening okno 2, test 3+4+5) i `anfis-w2w4` (trening 2+4, test
3+5) — po 5 seedów (42–46); w tabeli głównej wiersz `seed = 42` każdej nazwy ANFIS (przy jego
braku dla danej nazwy — najniższa wersja, `mainTableRows`, `packages/api/scripts/export-results-format.ts`),
stabilność między seedami w sekcji niżej.

<!-- BEGIN results/evaluation.md -->
<!-- generated: npm run export-results @ 6a4974c8af82f3e8103e2cd4f3b47c848dc4055f 2026-08-27T04:57:01.510Z -->

Populacja: zweryfikowane okazje o znanej etykiecie (`route IS NULL OR route <> 'multi'`), wszystkie pary; próg klasyfikacji 50; AUC z 95 % przedziałem ufności (bootstrap stratyfikowany, 1000 prób, seed 42); PR-AUC = average precision. `(tr)` = okno użyte do treningu/kalibracji.

Uwaga o formacie liczb: pliki CSV używają kropki dziesiętnej (RFC 4180); w tym dokumencie i w LaTeX-u liczby mają przecinek dziesiętny (pl-PL).

| Okno | Model (id) | n | n_pos | TP | FP | TN | FN | Precision | Recall | F1 | PR-AUC | AUC [95 % CI] |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2021-05 krach | baseline (1) | 2118 | 477 | 52 | 45 | 1596 | 425 | 0,536 | 0,109 | 0,181 | 0,331 | 0,627 [0,60–0,65] |
| 2021-11 ATH | baseline (1) | 886 | 20 | 0 | 12 | 854 | 20 | 0,000 | 0,000 | 0,000 | 0,038 | 0,599 [0,51–0,70] |
| 2022-05 Luna | baseline (1) | 1279 | 40 | 7 | 33 | 1206 | 33 | 0,175 | 0,175 | 0,175 | 0,107 | 0,713 [0,63–0,79] |
| 2022-11 FTX | baseline (1) | 402 | 7 | 2 | 14 | 381 | 5 | 0,125 | 0,286 | 0,174 | 0,097 | 0,788 [0,61–0,95] |
| wszystkie (2–5) | baseline (1) | 4685 | 544 | 61 | 104 | 4037 | 483 | 0,370 | 0,112 | 0,172 | 0,210 | 0,654 [0,63–0,68] |
| 2021-05 krach | mamdani (2) | 2118 | 477 | 8 | 28 | 1613 | 469 | 0,222 | 0,017 | 0,031 | 0,197 | 0,392 [0,36–0,42] |
| 2021-11 ATH | mamdani (2) | 886 | 20 | 0 | 18 | 848 | 20 | 0,000 | 0,000 | 0,000 | 0,017 | 0,359 [0,25–0,46] |
| 2022-05 Luna | mamdani (2) | 1279 | 40 | 0 | 25 | 1214 | 40 | 0,000 | 0,000 | 0,000 | 0,039 | 0,593 [0,52–0,67] |
| 2022-11 FTX | mamdani (2) | 402 | 7 | 0 | 0 | 395 | 7 | 0,000 | 0,000 | 0,000 | 0,037 | 0,731 [0,61–0,84] |
| wszystkie (2–5) | mamdani (2) | 4685 | 544 | 8 | 71 | 4070 | 536 | 0,101 | 0,015 | 0,026 | 0,097 | 0,354 [0,33–0,38] |
| 2021-05 krach | anfis (14) (tr) | 614 | 153 | 151 | 422 | 39 | 2 | 0,264 | 0,987 | 0,416 | 0,423 | 0,701 [0,66–0,74] |
| 2021-11 ATH | anfis (14) | 164 | 14 | 13 | 94 | 56 | 1 | 0,121 | 0,929 | 0,215 | 0,231 | 0,749 [0,61–0,86] |
| wszystkie (2–5) | anfis (14) | 778 | 167 | 164 | 516 | 95 | 3 | 0,241 | 0,982 | 0,387 | 0,406 | 0,733 [0,69–0,77] |
| 2021-05 krach | baseline_v2 W2 (44) (tr) | 2118 | 477 | 337 | 626 | 1015 | 140 | 0,350 | 0,706 | 0,468 | 0,397 | 0,700 [0,67–0,72] |
| 2021-11 ATH | baseline_v2 W2 (44) | 886 | 20 | 13 | 72 | 794 | 7 | 0,153 | 0,650 | 0,248 | 0,107 | 0,825 [0,74–0,90] |
| 2022-05 Luna | baseline_v2 W2 (44) | 1279 | 40 | 23 | 211 | 1028 | 17 | 0,098 | 0,575 | 0,168 | 0,138 | 0,800 [0,72–0,87] |
| 2022-11 FTX | baseline_v2 W2 (44) | 402 | 7 | 2 | 26 | 369 | 5 | 0,071 | 0,286 | 0,114 | 0,128 | 0,839 [0,70–0,95] |
| wszystkie (2–5) | baseline_v2 W2 (44) | 4685 | 544 | 375 | 935 | 3206 | 169 | 0,286 | 0,689 | 0,405 | 0,326 | 0,796 [0,78–0,81] |
| 2021-05 krach | anfis W2 (matrix) (45) (tr) | 2118 | 477 | 465 | 1424 | 217 | 12 | 0,246 | 0,975 | 0,393 | 0,426 | 0,712 [0,69–0,74] |
| 2021-11 ATH | anfis W2 (matrix) (45) | 886 | 20 | 17 | 567 | 299 | 3 | 0,029 | 0,850 | 0,056 | 0,073 | 0,737 [0,62–0,85] |
| 2022-05 Luna | anfis W2 (matrix) (45) | 1279 | 40 | 10 | 210 | 1029 | 30 | 0,045 | 0,250 | 0,077 | 0,055 | 0,702 [0,63–0,76] |
| 2022-11 FTX | anfis W2 (matrix) (45) | 402 | 7 | 0 | 40 | 355 | 7 | 0,000 | 0,000 | 0,000 | 0,032 | 0,677 [0,50–0,82] |
| wszystkie (2–5) | anfis W2 (matrix) (45) | 4685 | 544 | 492 | 2241 | 1900 | 52 | 0,180 | 0,904 | 0,300 | 0,269 | 0,787 [0,77–0,81] |
| 2021-05 krach | anfis W2+W4 (cross-regime) (46) (tr) | 2118 | 477 | 474 | 1608 | 33 | 3 | 0,228 | 0,994 | 0,370 | 0,415 | 0,707 [0,68–0,73] |
| 2021-11 ATH | anfis W2+W4 (cross-regime) (46) | 886 | 20 | 20 | 848 | 18 | 0 | 0,023 | 1,000 | 0,045 | 0,100 | 0,762 [0,64–0,87] |
| 2022-05 Luna | anfis W2+W4 (cross-regime) (46) (tr) | 1279 | 40 | 24 | 274 | 965 | 16 | 0,081 | 0,600 | 0,142 | 0,137 | 0,778 [0,71–0,84] |
| 2022-11 FTX | anfis W2+W4 (cross-regime) (46) | 402 | 7 | 2 | 21 | 374 | 5 | 0,087 | 0,286 | 0,133 | 0,126 | 0,879 [0,79–0,95] |
| wszystkie (2–5) | anfis W2+W4 (cross-regime) (46) | 4685 | 544 | 520 | 2751 | 1390 | 24 | 0,159 | 0,956 | 0,273 | 0,369 | 0,818 [0,80–0,83] |
| 2021-05 krach | baseline_v2 (47) (tr) | 2118 | 477 | 337 | 626 | 1015 | 140 | 0,350 | 0,706 | 0,468 | 0,397 | 0,700 [0,67–0,72] |
| 2021-11 ATH | baseline_v2 (47) | 886 | 20 | 13 | 72 | 794 | 7 | 0,153 | 0,650 | 0,248 | 0,107 | 0,825 [0,74–0,90] |
| 2022-05 Luna | baseline_v2 (47) | 1279 | 40 | 23 | 211 | 1028 | 17 | 0,098 | 0,575 | 0,168 | 0,138 | 0,800 [0,72–0,87] |
| 2022-11 FTX | baseline_v2 (47) | 402 | 7 | 2 | 26 | 369 | 5 | 0,071 | 0,286 | 0,114 | 0,128 | 0,839 [0,70–0,95] |
| wszystkie (2–5) | baseline_v2 (47) | 4685 | 544 | 375 | 935 | 3206 | 169 | 0,286 | 0,689 | 0,405 | 0,326 | 0,796 [0,78–0,81] |
| 2021-05 krach | anfis-w2w4 (48) (tr) | 2118 | 477 | 474 | 1608 | 33 | 3 | 0,228 | 0,994 | 0,370 | 0,415 | 0,707 [0,68–0,73] |
| 2021-11 ATH | anfis-w2w4 (48) | 886 | 20 | 20 | 848 | 18 | 0 | 0,023 | 1,000 | 0,045 | 0,100 | 0,762 [0,64–0,87] |
| 2022-05 Luna | anfis-w2w4 (48) (tr) | 1279 | 40 | 24 | 274 | 965 | 16 | 0,081 | 0,600 | 0,142 | 0,137 | 0,778 [0,71–0,84] |
| 2022-11 FTX | anfis-w2w4 (48) | 402 | 7 | 2 | 21 | 374 | 5 | 0,087 | 0,286 | 0,133 | 0,126 | 0,879 [0,79–0,95] |
| wszystkie (2–5) | anfis-w2w4 (48) | 4685 | 544 | 520 | 2751 | 1390 | 24 | 0,159 | 0,956 | 0,273 | 0,369 | 0,818 [0,80–0,83] |
| 2021-05 krach | anfis-w2 (49) (tr) | 2118 | 477 | 465 | 1424 | 217 | 12 | 0,246 | 0,975 | 0,393 | 0,426 | 0,712 [0,69–0,74] |
| 2021-11 ATH | anfis-w2 (49) | 886 | 20 | 17 | 567 | 299 | 3 | 0,029 | 0,850 | 0,056 | 0,073 | 0,737 [0,62–0,85] |
| 2022-05 Luna | anfis-w2 (49) | 1279 | 40 | 10 | 210 | 1029 | 30 | 0,045 | 0,250 | 0,077 | 0,055 | 0,702 [0,63–0,76] |
| 2022-11 FTX | anfis-w2 (49) | 402 | 7 | 0 | 40 | 355 | 7 | 0,000 | 0,000 | 0,000 | 0,032 | 0,677 [0,50–0,82] |
| wszystkie (2–5) | anfis-w2 (49) | 4685 | 544 | 492 | 2241 | 1900 | 52 | 0,180 | 0,904 | 0,300 | 0,269 | 0,787 [0,77–0,81] |

## Stabilność ANFIS między seedami

| Model | Okno | n modeli | AUC (mean ± sd) | PR-AUC (mean ± sd) |
|---|---|---|---|---|
| anfis | 2021-05 krach | 3 | 0,708 ± 0,010 | 0,426 ± 0,012 |
| anfis | 2021-11 ATH | 3 | 0,766 ± 0,028 | 0,249 ± 0,022 |
| anfis | wszystkie (2–5) | 3 | 0,739 ± 0,008 | 0,409 ± 0,012 |
| anfis-w2 | 2021-05 krach | 5 | 0,710 ± 0,004 | 0,420 ± 0,009 |
| anfis-w2 | 2021-11 ATH | 5 | 0,687 ± 0,038 | 0,055 ± 0,012 |
| anfis-w2 | 2022-05 Luna | 5 | 0,657 ± 0,062 | 0,065 ± 0,026 |
| anfis-w2 | 2022-11 FTX | 5 | 0,637 ± 0,107 | 0,039 ± 0,016 |
| anfis-w2 | wszystkie (2–5) | 5 | 0,719 ± 0,081 | 0,230 ± 0,070 |
| anfis-w2w4 | 2021-05 krach | 5 | 0,710 ± 0,003 | 0,420 ± 0,005 |
| anfis-w2w4 | 2021-11 ATH | 5 | 0,773 ± 0,013 | 0,098 ± 0,011 |
| anfis-w2w4 | 2022-05 Luna | 5 | 0,803 ± 0,015 | 0,151 ± 0,011 |
| anfis-w2w4 | 2022-11 FTX | 5 | 0,858 ± 0,031 | 0,138 ± 0,070 |
| anfis-w2w4 | wszystkie (2–5) | 5 | 0,822 ± 0,005 | 0,374 ± 0,004 |
<!-- END results/evaluation.md -->

## Proweniencja
- Eksport: `results/provenance.json` — git `6a4974c8af82f3e8103e2cd4f3b47c848dc4055f`,
  `2026-08-27T04:57:01.510Z`, Node `v24.13.0`, `@thi.ng/fuzzy 2.1.144`, `drizzle-orm 0.45.2`, host
  RPC `self-hosted` (`rpcHostFrom`, `packages/db/src/provenance.ts` — hosty-literały IP nie są
  serwowane jako identyfikujący ciąg, patrz kod).
- Liczności tabel w chwili eksportu: blocks 250 373, sync_events 795 618, swap_events 786 828,
  block_states 1 418 144, opportunities 4 829, opportunity_verifications 4 829, scoring_models 19,
  model_scores 23 189 864.
- Każdy model ANFIS/baseline_v2 niesie własny blok `provenance` w `scoring_models.metrics` (ADR 0008).

## Interpretacja (uczciwa)
- **Co mówi kalibracja o założeniach gazowych:** optimum siatki to `gasPriceFactor = 0`, czyli
  najlepszy ranking daje **zysk brutto bez odejmowania kosztu gazu**; przy `gasPriceFactor = 0`
  `gasUnits` nie ma znaczenia (150k wybrane przez kolejność siatki). Innymi słowy — na etykietach
  „skonsumowana z zyskiem" nasz szacunek kosztu gazu (`gasPrice` bloku × 220k) **szkodzi**
  rankingowi: boty płacą inaczej niż zakłada v1 (mediana ~153k gazu, pakiety Flashbots z `gas = 0`,
  przejęcie okazji w blokach o wysokim gazie). Progiem decyzyjnym staje się w praktyce
  `gross_profit ≳ 69 USD`. `weightOptTrade = 0` — ranga optymalnego wolumenu nic nie dodaje ponad
  zysk brutto (jest z nim silnie skorelowana).
- **Czy v2 domyka lukę do ANFIS:** tak, a nawet ją odwraca poza oknem treningowym — patrz tabela:
  `baseline_v2` vs `anfis-w2`, okna 2021-11 ATH i 2022-05 Luna (v2 wyżej) oraz „wszystkie" (v2 wyżej
  po AUC; na oknie treningowym 2021-05 krach `anfis-w2` minimalnie lepsze). Po F1 przy progu 50 v2
  wygrywa wszędzie — `anfis-w2` przy wagach klas ~13:1 klasyfikuje jako „wykonalna" większość okazji
  (wysoki recall, niska precision — patrz tabela). Wniosek: prawie cały zysk ANFIS-a względem
  baseline v1 (patrz tabela: baseline (1) vs `anfis-w2`, „wszystkie") da się uzyskać **jednym
  deterministycznym parametrem** (wyrzucenie kosztu gazu z rankingu); ANFIS nie wykazuje na cechach
  S/G/L/M dodatkowej struktury nieliniowej, która by v2 przebiła.
- **Generalizacja cross-regime (trening 2+4 → test 3+5):** patrz tabela — `anfis-w2w4` na oknach
  testowych (2021-11 ATH, 2022-11 FTX) ma wyższe AUC niż `anfis-w2` uczony tylko na krachu 2021, i
  najwyższe AUC „wszystkie" w tabeli głównej. Dołożenie reżimu z 2022 (Luna) pomaga na oknie FTX
  2022, ale nie na oknie ATH 2021 więcej niż `baseline_v2`. Uwaga: okno 2022-11 FTX ma **7
  pozytywów** — różnice AUC rzędu setnych to różnica jednego przykładu; `anfis-w2w4` przestał też
  rozróżniać cokolwiek na oknie 2021-11 ATH przy progu 50 (patrz TN/FP w tabeli), co pokazuje, że
  jego skala score nie przenosi się między reżimami nawet gdy ranking (AUC) tak.
- **Maleńka klasa dodatnia:** n_pos = 477 (okno 2), **20** (3), **40** (4), **7** (5). Na oknach 3–5
  jeden przykład przesuwa recall o 5 / 2,5 / 14 pp; precision/F1 przy progu 50 są tam kruche i
  zależą głównie od liczby FP, nie od jakości rankingu. **Porównywać AUC**, a i to z szerokim
  przedziałem ufności; wyniki na oknie 5 traktować jako anegdotę. Nawet „wszystkie okna" to tylko
  544 pozytywy na 4 685 okazji, z czego 88 % z jednego okna (krach 2021).
- Mamdani jest **poniżej losowego** na oknach 2021-05 krach/2021-11 ATH i „wszystkich" (patrz
  tabela, AUC < 0,4) — reguły ekspertowe karzą wysoki gaz/MEV, a to właśnie w takich blokach boty
  konsumują duże okazje z zyskiem; na oknach 2022-05 Luna/2022-11 FTX jest bliżej losowego lub lekko
  dodatni, ale z 0 TP.
- Uwaga: `training_metrics_summary` w `GET /models` (`metricsSummaryFrom`,
  `packages/api/src/anfisMetrics.ts`) czyta domyślnie `population_verified` — tę samą populację co
  `/models/:id/evaluation` (ADR 0008). Tylko starsze modele 13–15, zapisane przed wprowadzeniem
  bloku `population_verified`, wracają do jawnie oznaczonego `population: "block_states"` —
  **innej, łatwiejszej populacji** (wszystkie `block_states` okna testowego, tło bez okazji jako
  klasa 0), gdzie odróżnienie „okazja vs brak okazji" jest zwykle dużo łatwiejsze niż w populacji
  zweryfikowanej (zakres AUC tej populacji: ADR 0008). Miarodajne do porównania modeli są
  wyłącznie liczby z `/models/:id/evaluation` (= `results/evaluation.md`) powyżej — dla modeli
  13–15 `training_metrics_summary` NIE jest z nimi porównywalne.
- **Zastrzeżenia do danych** (szczegóły i metoda weryfikacji ręcznej: [`verification-method.md`](verification-method.md)):
  koszt gazu w oknie sprzed EIP-1559 odtwarzany z `gasPrice` transakcji (niepełna
  reprodukowalność kosztu arbitrażu), heurystyka beneficjenta (kto „skonsumował" okazję) oraz
  klasyfikacja trasy (`two_pool`/`multi`) — błędy tych heurystyk przenoszą się wprost na etykiety.

## Baseline v2 — „baseline skalibrowany" (`kind = 'baseline_v2'`)
Drugi model deterministyczny, obok baseline'u v1: te same wejścia co v1 (`gross_profit_usd`,
koszt gazu, `opt_trade_usd` z `block_states`), ale parametry kosztu gazu **dobrane na etykietach
weryfikacji** zamiast założone. Motywacja z danych (okna 2–4): boty konsumujące okazje zużywają
medianę ~153k gazu (v1 zakłada 220k), ich rzeczywisty koszt gazu to ≈0,65–0,78 naszego szacunku,
część konsumpcji ma `gas = 0` (pakiety Flashbots), a ranking po zysku BRUTTO daje AUC 0,70/0,83/0,80
wobec 0,59/0,75/0,77 po netto v1.

- **Ocena** (`BaselineV2Model` w `packages/core/src/baselineV2.ts`):
  `net2 = gross − (gasUnits/220k)·gasPriceFactor·kosztGazuV1`, gdzie `kosztGazuV1 = gross −
  baseline_net_profit_usd` (kurs ETH nie jest w `block_states`, ale różnica brutto−netto v1 odtwarza
  go dokładnie); `v = (1−w)·sigmoid(net2/scale) + w·ranga(opt_trade_usd)`; score = odcinkowo-liniowe
  `v → [0,100]` z `v = threshold ↦ 50` (score ≥ 50 ⇔ „wykonalna"; etykieta przez `labelForScore`).
- **Kalibracja** (`calibrateBaselineV2`, zadanie `calibrate:baseline_v2`): siatka
  `gasUnits ∈ {150k, 220k}` × `gasPriceFactor ∈ {0, 0,25, 0,5, 0,75, 1}` × `weightOptTrade ∈ {0, 0,25, 0,5}`
  na zweryfikowanych okazjach o znanej etykiecie (`route ≠ 'multi'`) z `train_windows`;
  `scale` = 1,4826·MAD net2, `threshold` = próg F1-optymalny; wybór po max AUC (remis → F1).
  Bez losowości. `test_windows` (opcjonalne) dają metryki holdoutu w `metrics.holdout`.
- **Zapis**: `scoring_models` (params: `gasUnits, gasPriceFactor, threshold, weightOptTrade, scale,
  optTradeQuantiles`; metrics: `population: 'verified_opportunities'`, `calibration`, `holdout`,
  `grid`) + `model_scores` dla WSZYSTKICH `block_states` okien train+test — `GET /models/:id/evaluation`
  działa bez zmian. `GET /models` dołącza `params` tylko dla tego kind.

Uruchomienie (migracja `0006_baseline_v2_kind` musi być zaaplikowana — dodaje wartości enumów
`model_kind.baseline_v2` i `job_type.calibrate:baseline_v2`):
```bash
curl -X POST localhost:3001/models/baseline_v2/calibrate -H 'content-type: application/json' \
  -d '{"train_windows":[2],"test_windows":[3],"name":"baseline_v2"}'
```
Dashboard: widok **Modele** — czwarta kolumna „Baseline v2 (skalibrowany)" z parametrami i formularz
„Kalibruj baseline v2" pod formularzem ANFIS.

## Historia

Zapis stanu dokumentu sprzed wprowadzenia proweniencji i generowanej tabeli wyników (poniżej —
dosłowna treść, nieaktualizowana; aktualne liczby patrz „Porównanie modeli" i „Proweniencja" wyżej).

**Dla porównania stara tabela (tylko WETH/USDC, okna 2 i 3; ANFIS = model 15)** (wartości z
26.08.2026, przed proweniencją; aktualne parametry: `scoring_models.params` najnowszego
`baseline_v2`, `results/evaluation.md`): baseline AUC 0,592 / 0,530, Mamdani 0,372 / 0,259, ANFIS
0,719 / 0,750 (n = 614 / 164, n_pos = 153 / 14). Model 15 ma `model_scores` tylko dla okien 2–3,
więc na oknach 4–5 daje n = 0.

**Parametry wybrane przez kalibrację baseline_v2 (model 44, zadanie 79)** (wartości z 26.08.2026,
przed proweniencją; aktualne parametry: `scoring_models.params` najnowszego `baseline_v2`,
`results/evaluation.md`): Siatka 2 × 5 × 3 na 2 118 okazjach okna 2 (477 pozytywów), wybór po max
AUC: **`gasUnits = 150 000`, `gasPriceFactor = 0`, `weightOptTrade = 0`**, `threshold = 0,728`
(≙ `thresholdNetUsd ≈ 69,4 USD`), `scale = 70,56`, `arbGasRef = 220 000`.
`metrics.calibration`: n 2118, AUC 0,700, F1 0,468, precision 0,350, recall 0,706.
`metrics.holdout` (okna 3+4+5 łącznie): n 2567, pozytywów 67, AUC 0,811, F1 0,184, precision 0,110,
recall 0,567 (TP 38, FP 309, TN 2191, FN 29).
Drugie i trzecie miejsce w siatce to ten sam `gasPriceFactor = 0` z `weightOptTrade` 0,25 / 0,5
(AUC 0,6998 / 0,6997); już `gasPriceFactor = 0,25` spada do AUC 0,66–0,69.
