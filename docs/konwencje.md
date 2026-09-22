# dex-arb-analyzer — konwencje i decyzje projektowe

## Cel
System (TypeScript + PostgreSQL + dashboard React) zbierający historyczne dane
z DEX-ów AMM (Uniswap V2, Sushiswap), wykrywający rozbieżności cenowe między
pulami tej samej pary, oceniający wykonalność arbitrażu trzema modelami
(baseline deterministyczny, FIS Mamdaniego, ANFIS) i
weryfikujący retrospektywnie, czy okazje były konsumowane on-chain.

## Zakres
- Pary V2 (fee 0,3 %): WETH/USDC, WETH/USDT, WETH/DAI, WBTC/WETH na Uniswap V2 + Sushiswap.
- Okna: 2021-05 krach, 2021-11 ATH, 2022-05 Luna, 2022-11 FTX — nazwy w tabeli `windows` (patrz `packages/ingest/src/seed-data.ts`).
- Dane: własny eRPC (archiwalny, `RPC_URL`), fallback publiczne RPC (`RPC_FALLBACK_URLS`).
- Poza zakresem: Uniswap V3, inne sieci, autoryzacja, i18n, WebSockety.

## Struktura (npm workspaces, ESM, TS strict, `NodeNext` → importy z `.js`)
- `packages/core` — matematyka AMM, cechy S/G/L/M, modele (`baseline`, `mamdani`, `anfis`), ewaluacja. Czysty TS, bez bazy.
- `packages/db` — schemat Drizzle (`src/schema/{config,raw,derived,jobs}.ts`), migracje (`drizzle/`), `createDb()`.
- `packages/shared` — zod + DTO dla api/web.
- `packages/ingest` — eventy Sync/Swap + bloki → Postgres (`ingest_ranges`, chunki, retry/rotacja RPC).
- `packages/analysis` — `block_states`, `opportunities`, weryfikacja retrospektywna, etykiety.
- `packages/api` — Fastify (bez auth). `packages/worker` — sekwencyjne wykonywanie `jobs`.
- `packages/web` — React + Vite + TanStack Query + Recharts, UI po polsku.

## Komendy
`npm run db:up` (Postgres 16) · `npm run db:generate` / `db:migrate` (`packages/db`) · `npm run db:seed`
(jedyny seed, `packages/ingest/scripts/seed.ts` — bez `--verify` używa adresów z `seed-data.ts`,
z `--verify` potwierdza je przez `factory.getPair()` na RPC) ·
`npm run typecheck` · `npm run lint` · `npm run test` (Vitest) · `npm run test:coverage`
(z pokryciem, próg 80% linii dla `packages/core`/`packages/analysis`) ·
`npm run export-results` (eksport tabel/metryk do `results/`) · `npm run data-dictionary`
(regeneruje `docs/data-dictionary.md` ze schematu Drizzle) · `npm run reproduce`
(= `scripts/reproduce.sh`, pełna reprodukcja wyników od czystej bazy).
Skrypty `db:migrate` i `seed` same wczytują `.env` z katalogu głównego repo
(`tsx --env-file=../../.env`) — nie trzeba go eksportować ręcznie przed ich uruchomieniem.

Worker: `npm run start -w @dex-arb/worker` (pętla po `jobs`, zatrzymanie SIGINT/SIGTERM po
bieżącym zadaniu) · `npm run jobs:enqueue -w @dex-arb/worker -- <type> '<json params>'` (zwraca id) ·
`npm run jobs:retry -w @dex-arb/worker -- <id>` (`status='queued', attempts=0`) · opcjonalny test na
prawdziwym eRPC: `RUN_LIVE_RPC=1 npm run test:live -w @dex-arb/ingest` (wymaga `RPC_URL`; bez bazy).

Analiza (etap 2): `npm run analyze -w @dex-arb/analysis -- --pair 1 --window 2` (CLI bezpośrednio,
bez kolejki, ładuje `.env` samo) albo przez kolejkę: `npm run jobs:enqueue -w @dex-arb/worker --
analyze:pair-window '{"pairId":1,"windowId":2}'` + `npm run start -w @dex-arb/worker`. `<pairId>`/
`<windowId>` z `SELECT id FROM pairs|windows`. Oba testy regresyjne wymagają
`REFERENCE_DATA_DIR=…` (katalog z danymi referencyjnymi) w środowisku — bez tej zmiennej są
pomijane — i czytają pliki bezpośrednio z tego katalogu, bez regeneracji:
`packages/analysis/test/regression-block-spreads.test.ts` (`events.csv`, `block_spreads.csv`)
i `packages/core/test/regression-may2021.test.ts` (`events.csv`, `gas_sample.csv`,
`block_spreads.csv`, `ratings.csv` — ten ostatni jest jedynym z tych plików generowanym, nie
statycznym, więc musi być w katalogu odtworzony wcześniej).

Testy integracyjne (DB) używają WYŁĄCZNIE `DATABASE_URL_TEST` — nigdy `DATABASE_URL` (dev/prod);
`packages/db/src/client.ts` eksportuje `createTestDb()`, która odmawia połączenia, jeśli nazwa bazy
w URL-u nie kończy się na `_test` (ochrona bazy deweloperskiej przed `TRUNCATE` z testów). Setup
jednorazowy: `npm run db:migrate:test` (tworzy schemat w bazie z `DATABASE_URL_TEST`; samą bazę
`dexarb_test` trzeba założyć raz: `docker compose exec -T postgres psql -U dexarb -d dexarb -c
"create database dexarb_test"`). Uruchomienie: `set -a; source .env; set +a; npm run test` — bez
`DATABASE_URL_TEST` w środowisku pakiety integracyjne są pomijane (`describe.skipIf`), reszta
(unit, offline) działa zawsze.

Uwaga: domyślny port hosta Postgresa w `docker-compose.yml` to **5433**, nie 5432 — port 5432
bywa zajęty przez lokalną instalację Postgresa, co po cichu blokuje połączenia TCP z hosta do
kontenera (sam kontener działa poprawnie, `docker compose exec` zawsze trafia we właściwą bazę).
`DATABASE_URL`/`DATABASE_URL_TEST` w `.env(.example)` wskazują na `5433`.

## Decyzje
- Rezerwy/kwoty: `numeric(40,0)`; ceny, spready, cechy: `double precision`. Adresy małymi literami, `char(42)`.
- FIS: `core/src/mamdani.ts` = logika referencyjnej implementacji FIS (AND=min, impl=min, agr=max, centroid 500);
  parametry w `MamdaniParams` (`DEFAULT_MAMDANI_PARAMS` = finalne z projektu; JSON w `scoring_models.params`).
  Termy negowane w regułach: prefiks `nie_` (np. `nie_plytka`). Kryterium regresji: |ΔW| ≤ 0,5 i ta sama etykieta.
- Cechy (etap 2): S spread [%], G koszt gazu vs 50 000 USD ref. [%], L TVL płytszej puli [mln USD],
  M = 50/50 percentyl swapów w bloku + percentyl gazu; percentyle per okno. Próg okazji 0,65 %
  (stała `OPPORTUNITY_THRESHOLD_PCT` w `packages/analysis/src/opportunities.ts`). Koszt arbitrażu
  ~220k gazu (`ARB_GAS`, `packages/core/src/features.ts`).
- Kierunek arbitrażu: `a` = pula Uniswap V2, `b` = pula Sushiswap; `direction: "a->b"` = base tańszy
  w Uniswap (kup tam, sprzedaj w Sushi), `"b->a"` odwrotnie. `arbitrage()` (`core/src/amm.ts`) i
  `BlockStateRow.direction` używają strzałek; enum bazy `direction_kind` (migracja 0002) —
  podkreślników (`a_to_b`/`b_to_a`/`none`, bo Postgres nie przyjmuje `->` w nazwie wartości enuma
  bez cudzysłowu). Mapowanie WYŁĄCZNIE na granicy zapisu, w `packages/analysis/src/db.ts`
  (`toDbDirection`) — `core` się nie zmienia.
- Gaz: `blocks.gas_price_median` jest w WEI (numeric); `block_states.gas_price_median` w GWEI
  (double precision) — konwersja (÷1e9) w `packages/analysis/src/loadInputs.ts`. `blocks` ma wiersz
  tylko dla bloków ze zdarzeniem (Sync/Swap); dla pozostałych bloków okna cena gazu jest
  interpolowana liniowo między najbliższymi „blokami zdarzeń" (`interpolateLinear`, tak jak `gasAt`
  w implementacji referencyjnej) — patrz `packages/analysis/src/analyzeWindow.ts`.
- `scoring_models` (etap 2): dwa modele, `baseline` v1 (`core/src/baseline.ts` — próg binarny na
  zysku netto, score = ROI·10 000) i `mamdani` v1 (adapter na `MamdaniModel`, parametry finalne
  z implementacji referencyjnej). `ensureScoringModels` (`packages/analysis/src/db.ts`) upsertuje po UNIQUE
  (name, version); modele budowane raz na wpis, nie per wiersz.
- Etykieta weryfikacji: `profitable_consumed = consumed_atomic ∧ realized_profit − gas_cost > 0`.
- Jobs: jeden worker, sekwencyjnie, idempotentne i wznawialne; `RPC_CONCURRENCY`=4, `LOGS_CHUNK_BLOCKS`=10 000.
- Odstępstwa schematu od specu uzgodnione międzyetapowo: `swap_events.sender/to/amount*` nullable (import CSV
  nie ma tych danych; backfill je uzupełnia), `jobs.attempts`, `block_states.direction` + `gross_profit_usd` obecne
  od migracji 0000.
- zod 4: reguła `if` używa `z.partialRecord` + `refine` (niepuste); sprawdzanie termów przez `Object.hasOwn`.

- Zewnętrzny `events.csv` (patrz warstwa regresji w README) jest zdegradowany: część wierszy ma `logIndex` uszkodzony przepełnieniem uint32 (szczegóły i liczby: komentarz na górze `packages/ingest/src/jobs/import-csv.ts`; decyzja i konsekwencje: `docs/adr/0001-rpc-jedyne-zrodlo.md`). `import:csv` POMIJA te wiersze i NIE poszerza `log_index` do bigint. **`import:csv` to wyłącznie test parytetu — wolno go puszczać tylko na osobnej/testowej bazie (nigdy na puli, która ma być zasilana z RPC); handler odmawia importu, jeśli pula ma już jakiekolwiek wiersze w `ingest_ranges`.** Jedynym źródłem danych dla docelowych baz (dev/prod) jest `ingest:pool-window` z RPC.

## Stan i dokumentacja

Aktualne liczności i wyniki pochodzą z `results/` (generowane przez `npm run export-results`),
nie z tego pliku. Pozostała dokumentacja:
- `docs/methodology.md` — dane, cechy, modele, etykiety, protokół ewaluacji.
- `docs/adr/README.md` — decyzje projektowe (ADR) z kontekstem, konsekwencjami i odrzuconymi
  alternatywami.
- `docs/anfis.md` — ANFIS, baseline v2, porównanie modeli.

## Konwencje
- Kod, komentarze, commity, UI — po polsku (nazwy identyfikatorów po angielsku).
- TDD: test przed implementacją; `npm run typecheck && npm run lint && npm run test` przed commitem.
- Cena z rezerw (token0=USDC 6 dec, token1=WETH 18 dec): (reserve0/1e6)/(reserve1/1e18) = USDC za 1 WETH.
