# ADR 0002: Próg okazji S > 0,65% = 2 × 0,3% prowizji

**Status:** przyjęty · **Data:** 2026-08-27 · **Dotyczy:** `packages/core/src/constants.ts` i `packages/shared/src/constants.ts` (`SPREAD_THRESHOLD_PCT`), `packages/analysis/src/opportunities.ts` (`OPPORTUNITY_THRESHOLD_PCT`), `packages/core/src/mamdani.params.ts` (term `znikoma`)

## Kontekst
Blok musi zostać oznaczony jako „okazja" zanim system w ogóle podejmie się jej dalszej analizy
(cechy G/L/M, ocena modeli, weryfikacja retrospektywna) — potrzebny jest więc pojedynczy,
niezależny od modelu próg spreadu S. Arbitraż dwupulowy na Uniswap V2/Sushiswap V2 płaci prowizję
`fee = 30 bps` w KAŻDEJ z dwóch pul (`docs/methodology.md` §1) — łącznie 0,6% kosztu strukturalnego
niezależnie od gazu, rozmiaru handlu czy MEV. Próg musi więc leżeć powyżej tej sumy, inaczej
większość „okazji" byłaby z definicji niewykonalna po samych prowizjach.

## Decyzja
Blok jest okazją, gdy `S > SPREAD_THRESHOLD_PCT = 0,65%` — margines 0,05 pp ponad `2 × 0,3%` na
zaokrąglenia i szum pomiarowy rezerw. Stała jest zduplikowana jako literał w `core` i `shared`
(graf zależności pakietów zabrania `shared` zależeć od `core`), z testem równości pilnującym
zgodności obu miejsc (`packages/analysis/test/constants-parity.test.ts`). Ten sam próg 0,65% jest granicą lewego ramienia
termu `znikoma` zmiennej S w FIS Mamdaniego (`invRamp(0,3; 0,65)`, `mamdani.params.ts`) — reguła R1
(`S = znikoma` → `niewykonalna`) koduje więc dokładnie tę samą intuicję ekonomiczną wewnątrz modelu
rozmytego, którą próg okazji koduje na poziomie detekcji.

## Konsekwencje
+ Jeden próg używany spójnie do detekcji okazji I do wetującej reguły R1 Mamdaniego — brak
  rozjazdu między „co system w ogóle rozważa" a „co model ocenia jako niewykonalne z powodu
  spreadu".
+ Detekcja jest tania i niezależna od modelu — nie wymaga defuzyfikacji ani liczenia G/L/M, żeby
  odrzucić oczywiście niewykonalne bloki.
− Odsetek bloków-okazji w oknie jest niewielki: 0,10% (okno 5, 406/400 860) do 0,72% (okno 2,
  2 236/309 548) block_states, łącznie 0,34% (4 829/1 418 144 po pełnej macierzy 4 pary × 4 okna —
  `docs/anfis.md`, tabela liczności per okno), więc zbiór uczący modeli jest silnie
  niezbalansowany (stąd podpróbkowanie tła w `buildDataset`, `negativesPerPositive = 10`).
− Próg nie uwzględnia poślizgu (price impact) ani rzeczywistego kosztu gazu — jest dolną granicą
  „spread strukturalnie większy niż prowizje", nie kryterium wykonalności netto; wykonalność ocenia
  dopiero warstwa modeli (baseline/Mamdani/ANFIS, `docs/methodology.md` §3).

## Alternatywy odrzucone
- Próg liczony od szacowanego zysku netto (`est_profit_usd > 0`) zamiast od samego spreadu —
  zależny od zmiennego szacunku kosztu gazu, więc próg detekcji przesuwałby się razem z reżimem
  gazowym zamiast być stałą strukturalną transakcji.
- Próg 1% (bezpieczniejszy margines) — w danych oknie 2 (2021-05) odrzucał okazje realnie
  konsumowane przez boty MEV tuż powyżej progu prowizji, zaniżając recall wykrywania.
