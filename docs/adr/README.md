# ADR — decyzje projektowe

Architecture Decision Records dla `dex-arb-analyzer` (praca inżynierska). Każdy ADR opisuje jedną
decyzję o dużej wadze, która inaczej istniałaby wyłącznie jako komentarz w kodzie: kontekst
(problem/dane, które ją wymusiły), samą decyzję, jej konsekwencje (plusy i minusy — nie tylko
uzasadnienie) i odrzucone alternatywy. Każdy dokument mieści się w ≤ 1 stronie (≈ 250–450 słów) wg
wspólnego szablonu (Kontekst / Decyzja / Konsekwencje / Alternatywy odrzucone). Metodyka
(`docs/methodology.md`) cytuje te ADR-y w miejscach, gdzie decyzja wpływa na dane/cechy/etykiety/
protokół ewaluacji, zamiast powtarzać uzasadnienie w tekście metodyki.

| ADR | Tytuł | Streszczenie |
|---|---|---|
| [0001](0001-rpc-jedyne-zrodlo.md) | RPC jako jedyne źródło danych; zewnętrzny CSV odrzucony | Zewnętrzny `events.csv` ma 12 004 wiersze z uszkodzonym `logIndex` (przepełnienie uint32) — jedynym autorytatywnym źródłem danych jest re-ingest z archiwalnego RPC. |
| [0002](0002-prog-okazji-065.md) | Próg okazji S > 0,65% = 2 × 0,3% prowizji | Blok jest okazją dopiero powyżej sumy prowizji dwóch pul V2 — ten sam próg jest granicą termu `znikoma` w FIS Mamdaniego (reguła wetująca R1). |
| [0003](0003-trasa-two-pool-multi.md) | Klasyfikacja trasy two_pool/multi i etykieta „nieokreślona" | Tx konsumujące przez agregator/V3 dają fałszywie wysoki „zysk" liczony tylko z dwóch tokenów pary — takie trasy (`multi`) dostają nieznaną etykietę i są wykluczone z populacji uczenia/ewaluacji. |
| [0004](0004-eth-weth-jeden-aktyw.md) | ETH i WETH jako jeden aktyw; noga natywna zawsze na `receipt.from` | Unwrap/wrap WETH nie emituje Transferu — bez rozliczenia nogi natywnej kontrakt self-funded wygląda jak beneficjent całej kwoty (błąd rzędu 1,6 mln USD w jednej tx), zamiast realnych kilkudziesięciu tysięcy USD. |
| [0005](0005-beneficjent-max-netto.md) | Beneficjent konsumpcji = adres o maksymalnym netto USD | Wymóg wspólnego `to` obu swapów zaniżał zysk do zera dla 62% konsumpcji w oknie 2 — beneficjentem jest kandydat (swap `to`, `tx.from`, `receipt.to`, odbiorcy Transferu) o maksymalnym netto USD przepływów tokenów pary. |
| [0006](0006-baseline-v2-i-asymetria-progow.md) | Baseline v2 skalibrowany (`gasPriceFactor = 0`) i asymetria progów decyzyjnych | Kalibracja na etykietach wskazuje, że ranking po zysku brutto (bez kosztu gazu) bije nasz szacunek netto v1 — v2 ma próg dobrany na danych, inne modele stały próg 50, więc tabela główna raportuje AUC/PR-AUC jako podstawowe, F1 pomocniczo. |
| [0007](0007-podzial-grupowo-swiadomy.md) | Podział train/test grupowo świadomy (grupa = tx konsumująca) | 198 okazji okna 2 pochodzi tylko ze 129 unikalnych tx konsumujących — podział wiersz-po-wierszu przeciekałby prawie identyczne sąsiednie okazje między train i test; grupy (tx/klaster/tło) są dzielone w całości. |
| [0008](0008-dwie-populacje-ewaluacji.md) | Dwie jawnie nazwane populacje ewaluacji | AUC na populacji `block_states` (tło vs okazja) jest trywialnie wysokie (≈ 0,998) i myliło się z AUC na zweryfikowanych okazjach (0,71–0,79) pod tą samą nazwą — metryki są teraz zapisywane osobno jako `population_block_states` (diagnostyczna) i `population_verified` (do porównań modeli). |
