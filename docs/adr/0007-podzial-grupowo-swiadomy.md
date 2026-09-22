# ADR 0007: Podział train/test grupowo świadomy (grupa = tx konsumująca)

**Status:** przyjęty · **Data:** 2026-08-26 · **Dotyczy:** `packages/analysis/src/anfis/dataset.ts` (`computeGroupKeys`, `BLOCK_CLUSTER_GAP_MAX`), `packages/worker/src/jobs/train.ts` (`splitTrainTestByTime`), `packages/core/src/anfis/split.ts` (`splitStratifiedGroups`)

## Kontekst
198 zweryfikowanych atomowych okazji okna 2 (WETH/USDC, pair_id=1, window_id=2) pochodzi tylko ze
129 unikalnych `consumer_tx_hash` — potwierdzone bezpośrednim zapytaniem read-only na bazie dev
2026-08-27: `SELECT count(*), count(DISTINCT v.consumer_tx_hash) FROM opportunity_verifications v
JOIN opportunities o ON o.id = v.opportunity_id WHERE v.status = 'consumed_atomic' AND o.pair_id = 1
AND o.window_id = 2;` → `198|129` (ten sam fakt jest opisany jakościowo w komentarzu
`computeGroupKeys`, `packages/analysis/src/anfis/dataset.ts`, i w `packages/worker/src/jobs/train.ts`).
Sąsiednie okazje (blok B, B+1, B+2…) często dzielą tę samą tx konsumującą (np. okazje 2 i 3, obie
konsumowane przez tx `0xe2991cbb…` — `docs/verification-method.md`, Tabela 1, wiersze 2–3) i mają
niemal identyczne cechy S/G/L/M oraz identyczną etykietę. Podział train/test wiersz-po-wierszu (np.
losowy albo chronologiczny bez świadomości grup) przeciekałby taką grupę jednocześnie do obu zbiorów
— model „widziałby" podczas treningu niemal ten sam przykład, który potem ocenia jako test, sztucznie
zawyżając metryki.

## Decyzja
`computeGroupKeys` przypisuje każdemu wierszowi klucz grupowy: `tx:<hash>` dla zweryfikowanej okazji
z `consumerTxHash`; dla okazji bez tx (status `persisted`/`decayed`) — `cluster:<pairId>:<windowId>:<k>`,
gdzie klaster to sekwencja kolejnych okazji tej samej pary i okna z przerwą między blokami
≤ `BLOCK_CLUSTER_GAP_MAX = 3` (`windowId` w kluczu zapobiega scaleniu klastrów przez granicę okna przy
treningu na wielu oknach naraz); tło (`!isOpportunity`) dostaje singleton `bg:<pairId>:<block>`. Grupy
są stratyfikowane etykietą większościową (nie wierszem), a ostatnie 20% grup CHRONOLOGICZNIE (wg
`pairId`, potem najwcześniejszy blok grupy) w każdej klasie trafia do testu w całości —
`splitTrainTestByTime` (worker). Ten sam mechanizm grupowy działa WEWNĄTRZ treningu ANFIS
(`splitStratifiedGroups`, `packages/core/src/anfis/split.ts`, wywoływane z `packages/core/src/anfis/train.ts`)
dla wewnętrznego podziału train/val używanego przez early stopping.

## Konsekwencje
+ Metryki na teście są niższe niż przy (błędnym) losowym podziale, ale uczciwe — nie zawierają
  wycieku niemal identycznych przykładów między train i test.
+ Liczba grup (`nGroupsTrain`) i diagnostyka (`diagnostics.groups`, `zeroGasConsumers`,
  `estProfitNegativeButProfitable` — `computeDiagnostics`, `train.ts`) są zapisywane w metrykach
  modelu, więc rozmiar efektywnego zbioru uczącego (nie tylko liczbę wierszy) widać wprost.
+ Ten sam mechanizm chroni zarówno zewnętrzny podział train/test (na poziomie jobu), jak i
  wewnętrzny train/val treningu ANFIS (early stopping) — brak niespójności między dwoma poziomami
  walidacji.
− Grupowanie po `consumer_tx_hash` zakłada, że dwie okazje dzielące tę samą tx są rzeczywiście
  „tym samym przykładem ekonomicznym" — upraszczające założenie, gdy tx konsumuje dwie niezależne
  okazje o różnym charakterze (rzadkie w danych, nieobsłużone osobno).
− Stratyfikacja po etykiecie WIĘKSZOŚCIOWEJ grupy (nie każdego wiersza) może w skrajnym przypadku
  umieścić w teście grupę o mieszanej etykiecie sklasyfikowaną „niepoprawnie" dla mniejszościowych
  wierszy tej grupy — akceptowalne przy rozmiarze grup w tych danych (przeważnie 1–3 wiersze).

## Alternatywy odrzucone
- Losowy podział wiersz-po-wierszu — najprostszy, ale bezpośrednio przecieka grupy (opisany wyżej
  problem) i sztucznie zawyża wszystkie metryki testowe.
- Podział po blokach (np. „ostatnie N bloków do testu") bez świadomości grup — nadal przecieka tx
  konsumującą, która rozciąga się na granicy podziału (okazja B tuż przed granicą i B+1 tuż za nią,
  ta sama tx konsumująca).
