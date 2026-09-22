# ADR 0006: Baseline v2 skalibrowany (`gasPriceFactor = 0`) i asymetria progów decyzyjnych

**Status:** przyjęty · **Data:** 2026-08-26 · **Dotyczy:** `packages/core/src/baselineV2.ts` (`BaselineV2Model`, `calibrateBaselineV2`), `packages/worker/src/jobs/calibrateBaselineV2.ts`, `docs/methodology.md` §5 „Próg i metryki"

## Kontekst
Baseline v1 zakłada stały koszt gazu transakcji arbitrażowej (`ARB_GAS = 220 000`). Dane weryfikacji
retrospektywnej (okna 2–4) pokazują, że boty konsumujące okazje płacą medianę ~153k gazu (nie 220k),
część konsumpcji ma `gasPrice = 0` (pakiety Flashbots dostarczone bezpośrednio budowniczemu bloku), a
ranking okazji po zysku BRUTTO daje wyższe AUC niż ranking po zysku netto v1 (`docs/anfis.md`,
sekcja „Baseline v2") — nasz szacunek kosztu gazu, mimo poprawności arytmetycznej, jest złym
predyktorem tego, które okazje boty faktycznie skonsumują z zyskiem.

## Decyzja
Drugi model deterministyczny, bez uczenia gradientowego i bez losowości: `net2 = gross −
(gasUnits/arbGasRef) · gasPriceFactor · gasCostV1`, `v = (1−w) · sigmoid(net2/scale) + w ·
rank(optTrade)` ∈ [0,1], `score` odcinkowo-liniowe z `v = threshold ↦ 50`. Kalibracja
(`calibrateBaselineV2`) przeszukuje siatkę deterministycznie: `gasUnits ∈ {150 000, 220 000} ×
gasPriceFactor ∈ {0; 0,25; 0,5; 0,75; 1} × weightOptTrade ∈ {0; 0,25; 0,5}` (30 kombinacji),
`scale = 1,4826 · MAD(net2)` na zbiorze kalibracyjnym, próg F1-optymalny na `v`
(`bestF1Threshold`), wybór punktu maksymalizującego AUC (remis → wyższe F1, dalszy remis → pierwszy
w kolejności siatki). Wynik kalibracji na oknie 2 (2 118 okazji, 477 pozytywów, zadanie 79,
`docs/anfis.md`): **`gasUnits = 150 000`, `gasPriceFactor = 0`, `weightOptTrade = 0`,
`threshold ≈ 0,728` (≈ 69,4 USD zysku brutto), `scale ≈ 70,56`** — drugie/trzecie miejsce siatki to
ten sam `gasPriceFactor = 0` (AUC 0,6998/0,6997 vs 0,700 wybrane), już `gasPriceFactor = 0,25`
spada do AUC 0,66–0,69. Ponieważ v2 ma próg dobrany na etykietach, a Mamdani/ANFIS/v1 mają stały
próg 50, porównania F1/precision/recall między modelami nie są bezpośrednio „fair" — postanowienie:
tabela główna raportuje **AUC/PR-AUC jako podstawowe**, F1 pomocniczo, oraz `threshold_train_opt`
liczony dla KAŻDEGO modelu tym samym algorytmem (`thresholdOptF1`) na jego oknach treningowych
(`docs/methodology.md` §5).

## Konsekwencje
+ Holdout (okna 3+4+5 łącznie, model 44): AUC 0,811, F1 0,184, precision 0,110, recall 0,567
  (`docs/anfis.md`) — baseline v2 ma najwyższe AUC spośród modeli uczonych tylko na oknie 2,
  na oknach 3 (0,825) i 4 (0,800) przebijając ANFIS-45 poza jego oknem treningowym.
+ Asymetria progów jest jawnie udokumentowana zamiast ukryta — czytelnik metodyki wie, że F1 przy
  progu 50 nie jest porównaniem „na równych prawach" między v2 a resztą modeli.
− Kalibracja na jednym oknie (2, krach 2021-05) niesie ryzyko nadmiernego dopasowania do reżimu
  gazowego tego okresu — częściowo adresowane przez raportowanie holdoutu (3+4+5) osobno od metryk
  kalibracyjnych (`metrics.calibration` vs `metrics.holdout`).

## Alternatywy odrzucone
- Przeliczenie progu 50 na `threshold_train_opt` we wszystkich zapisanych `model_scores.label` —
  odrzucone: zmienia semantykę już zapisanych etykiet w bazie, którą czytają inne części systemu
  (dashboard, `GET /models/:id/evaluation`).
- Usunięcie modelu v2 jako „nieuczciwego" wobec stałego progu 50 — odrzucone: to najsilniejszy
  punkt odniesienia w tej pracy (AUC 0,796 na wszystkich oknach łącznie, `docs/anfis.md`),
  a asymetria jest w pełni udokumentowana zamiast ukryta.
