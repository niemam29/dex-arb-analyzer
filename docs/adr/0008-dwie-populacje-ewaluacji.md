# ADR 0008: Dwie jawnie nazwane populacje ewaluacji

**Status:** przyjęty · **Data:** 2026-08-27 · **Dotyczy:** `packages/worker/src/jobs/evaluatePopulations.ts`, `packages/shared/src/dto/modelMetrics.ts` (`population_block_states`, `population_verified`), `packages/api/src/anfisMetrics.ts` (`metricsSummaryFrom`) i `packages/api/src/routes/catalog.ts` (`training_metrics_summary`)

## Kontekst
`scoring_models.metrics.test.auc` z zadania treningowego ANFIS liczy AUC na populacji
`block_states` — WSZYSTKICH blokach okna (tło = klasa 0 vs okazja = klasa 1). Odróżnienie „okazja vs
brak okazji" jest tam trywialne z samej definicji S > 0,65% (AUC ≈ 0,998–0,999,
`docs/anfis.md`), więc ta liczba systematycznie zawyża wrażenie jakości modelu. Ta sama nazwa
pola „metrics"/„AUC" była jednocześnie używana dla `GET /models/:id/evaluation`, gdzie AUC liczone
jest na populacji zweryfikowanych okazji — w pełnej macierzy modeli/okien tej pracy (baseline,
Mamdani, baseline_v2, ANFIS-45, ANFIS-46 × okna 2–5 i zbiorczo, `docs/anfis.md`, tabela
„Porównanie modeli") to AUC 0,354–0,825 (łącznie z wierszami zbiorczymi; poza anegdotycznym oknem 5,
gdzie n_pos = 7 — wykluczonym z tego zakresu zgodnie z zastrzeżeniem `docs/methodology.md` §5
„Niepewność"). Ten sam model potrafi więc mieć AUC ≈ 0,998 na populacji `block_states` i AUC gdzieś
w przedziale 0,354–0,825 na populacji
zweryfikowanych okazji — dwie różne liczby (różnica rzędu 0,2–0,6 pkt AUC) pod tą samą etykietą
„metrics"/„AUC" myliły odbiorcę (dashboard, sprawozdanie) co do tego, którą populację czyta.

## Decyzja
Metryki są zapisywane w dwóch jawnie nazwanych populacjach: `population_block_states` (wszystkie
`block_states` okna, tło jako klasa 0 — diagnostyczna, „czy model w ogóle odróżnia okazję od tła")
i `population_verified` (zweryfikowane okazje o znanej etykiecie, `route ≠ 'multi'`, ADR 0003) —
obie liczone przez `evaluatePopulations` (`packages/worker/src/jobs/evaluatePopulations.ts`) i
zapisywane razem z blokiem `provenance` (git SHA, wersje bibliotek, host RPC, zakresy bloków i
liczności okien w chwili treningu). API (`training_metrics_summary`, liczone przez `metricsSummaryFrom`
w `packages/api/src/anfisMetrics.ts` i serwowane przez `GET /models` w `packages/api/src/routes/catalog.ts`)
i dokumenty metodyki domyślnie czytają `population_verified`; porównania modeli między sobą (tabela główna
metodyki) używają WYŁĄCZNIE tej populacji. `population_block_states` pozostaje dostępna
diagnostycznie, ale nie służy do porównań.

## Konsekwencje
+ Jedna, jednoznacznie nazwana ścieżka odczytu metryk porównawczych (`population_verified`) —
  eliminuje ryzyko pomylenia trywialnej separacji tło/okazja z rzeczywistą jakością rankingu
  wykonalności.
+ `population_block_states` zostaje jako osobny sygnał diagnostyczny — przydatny do potwierdzenia,
  że detekcja okazji (próg S, ADR 0002) działa poprawnie, niezależnie od jakości modelu oceny.
+ Stare wiersze `scoring_models` sprzed tego podziału pozostają czytelne (`AnfisMetricsReadSchema`
  z polem `population: 'block_states'`, `packages/shared/src/dto/modelMetrics.ts`) — brak migracji
  wstecznej danych.
− Dwie populacje w jednym rekordzie `metrics` (JSON) zwiększają rozmiar zapisu i wymagają, żeby
  każdy nowy konsument metryk jawnie wybrał, którą populację czyta — ryzyko regresji w przyszłym
  kodzie, jeśli ktoś ponownie sięgnie po `population_block_states` do porównania modeli.

## Alternatywy odrzucone
- Usunięcie populacji `block_states` całkowicie — traci diagnostykę „czy model w ogóle odróżnia
  okazję od braku okazji", niezależną od jakości heurystyk weryfikacji retrospektywnej (ADR 0003,
  0005), na której opiera się `population_verified`.
- Zachowanie jednego niejednoznacznie nazwanego pola `metrics` (status quo sprzed tej decyzji) —
  źródło błędu, które ta decyzja usuwa; odrzucone jako przyczyna problemu, nie rozwiązanie.
