# dex-arb-analyzer

![CI](https://github.com/niemam29/dex-arb-analyzer/actions/workflows/ci.yml/badge.svg)

Analiza historycznych okazji arbitrażowych między Uniswap V2 a Sushiswap. Projekt powstał jako
praca inżynierska. System pobiera z łańcucha historię obu giełd, szuka bloków, w których ceny tej
samej pary rozjechały się między pulami, ocenia wykonalność takiego arbitrażu trzema modelami
(progowa heurystyka, system rozmyty Mamdaniego, ANFIS), a potem sprawdza w danych, czy okazja
rzeczywiście została wykorzystana.

## Wymagania

- Node ≥ 20 i npm ≥ 10. Wyniki w `results/` powstały na v24.13.0.
- Docker — Postgres 16 stawiany przez `docker compose`.
- Archiwalny węzeł Ethereum w `RPC_URL`, sięgający bloków z lat 2021–22.

Publiczne endpointy z `RPC_FALLBACK_URLS` są tylko zapasem na wypadek błędów. Samodzielnie nie
wystarczą: `eth_getLogs` na blokach sprzed kilku lat przekracza ich limity albo trafia poza
retencję.

## Szybki start

```bash
cp .env.example .env
npm install
npm run db:up && npm run db:migrate && npm run db:seed
npm run dev   # api + worker + web równolegle
```

Dashboard stoi na http://localhost:5173 i przekierowuje na `/dane`. API słucha na
http://localhost:3001, Postgres na porcie hosta **5433** (nie 5432 — patrz `.env.example`).
Listę tras API najłatwiej przejrzeć w `packages/api/src/routes/`.

`npm run dev` odpala trzy procesy przez `concurrently`, Ctrl+C ubija wszystkie naraz. Pojedynczo:
`npm run dev -w @dex-arb/api`, `npm run dev -w @dex-arb/web`.

## Konfiguracja

Wzór pliku `.env` leży w `.env.example`, razem z komentarzami o jednostkach.

| Nazwa | Wymagana | Domyślna | Opis |
|---|---|---|---|
| `DATABASE_URL` | tak | `postgres://dexarb:dexarb@localhost:5433/dexarb` | Baza deweloperska. |
| `DATABASE_URL_TEST` | nie | `postgres://dexarb:dexarb@localhost:5433/dexarb_test` | Baza testów integracyjnych; nazwa musi kończyć się na `_test`. Bez niej te testy są pomijane. |
| `RPC_URL` | tak dla ingestu, analizy i weryfikacji | puste | Archiwalny węzeł Ethereum. |
| `RPC_FALLBACK_URLS` | nie | `https://ethereum-rpc.publicnode.com,https://eth.drpc.org,https://eth.llamarpc.com` | Publiczne RPC używane po błędach, rotacja po przecinkach. |
| `RPC_CONCURRENCY` | nie | `4` | Równoległość zapytań RPC. |
| `LOGS_CHUNK_BLOCKS` | nie | `10000` | Rozmiar chunku dla `eth_getLogs`; przy odrzuceniu odpowiedzi dzielony na pół. |
| `JOB_MAX_ATTEMPTS` | nie | `3` | Liczba prób zadania przed oznaczeniem go jako `failed`. |
| `WORKER_POLL_MS` | nie | `2000` | Odstęp odpytywania kolejki przez workera. |
| `LIVE_ENABLED` | nie | puste | Włącza panel „Na żywo". Bez `RPC_URL` panel i tak zostaje wyłączony. |
| `LIVE_POLL_MS` | nie | `15000` | Odstęp między próbkami panelu. |
| `LIVE_HISTORY` | nie | `240` | Pojemność bufora historii próbek. |
| `LIVE_MODELS_REFRESH_MS` | nie | `300000` | Odstęp odświeżania parametrów modeli w panelu. |

## Architektura

```mermaid
flowchart LR
  RPC[(RPC archiwalny)] -->|eth_getLogs, bloki| ingest
  ingest -->|sync_events, swap_events, blocks| DB[(PostgreSQL)]
  DB --> analysis[analysis: block_states, opportunities, model_scores]
  analysis --> DB
  DB --> verify[analysis/verify: opportunity_verifications]
  RPC -->|receipty| verify
  verify --> DB
  DB --> train[worker: train / calibrate]
  train -->|scoring_models| DB
  worker[worker: kolejka jobs] -.uruchamia.-> ingest & analysis & verify & train
  DB --> api[api: Fastify] --> web[web: React]
  core[core: AMM, cechy, modele, ewaluacja] --- analysis & api & train
```

Repozytorium jest monorepozytorium npm. Cała matematyka siedzi w `core`: arytmetyka AMM, cechy
S/G/L/M, trzy modele oceny i metryki ewaluacji. To czysty TypeScript, bez dostępu do bazy i sieci,
dzięki czemu testuje się go jednostkowo. `db` trzyma schemat Drizzle i migracje, `shared` —
kontrakty zod wspólne dla API i frontu.

Pozostałe pakiety robią robotę: `ingest` ściąga zdarzenia `Sync`/`Swap` z RPC, `analysis` liczy
cechy, wykrywa okazje i weryfikuje je retrospektywnie, `api` serwuje dane dashboardowi, `worker`
wykonuje zadania z kolejki po kolei, `web` rysuje interfejs.

Zadania układają się w łańcuch: `ingest:pool-window` → `analyze:pair-window` →
`verify:pair-window` → `calibrate:baseline_v2` albo `train`. Każdy krok jest idempotentny, więc
przerwany można puścić od nowa bez sprzątania.

## Reprodukcja wyników

```bash
npm run reproduce                    # pełny przebieg, szacunek czasu w nagłówku scripts/reproduce.sh
npm run reproduce -- --skip-ingest   # bez ingestu, na gotowej bazie
npm run export-results -- --latex    # eksport tabel i wersji LaTeX do results/
npm run data-dictionary              # regeneruje docs/data-dictionary.md ze schematu
```

W repozytorium leżą trzy pliki wynikowe: `results/evaluation.md`,
`results/evaluation-sensitivity.md` i `results/provenance.json`. Dzięki nim wyniki można obejrzeć
bez stawiania bazy. Reszta katalogu jest ignorowana i powstaje na nowo przy eksporcie.

## Testy

```bash
npm run test                          # backend, projekt Vitest „node”
cd packages/web && npx vitest run     # web, osobny projekt (jsdom)
npm run test:coverage                 # z pokryciem, próg 80% linii dla core i analysis
```

Testy dzielą się na cztery warstwy. Jednostkowe działają zawsze. Integracyjne łączą się wyłącznie
przez `DATABASE_URL_TEST` — `createTestDb` odmawia połączenia z bazą bez sufiksu `_test`, żeby
`TRUNCATE` z testów nie trafił w bazę deweloperską. Trzecia warstwa to testy na żywym węźle
(`RUN_LIVE_RPC=1`). Czwarta porównuje cechy i etykiety z niezależnie policzonym zbiorem
referencyjnym, wskazanym przez `REFERENCE_DATA_DIR`; zbiór nie wchodzi w skład repozytorium.

Bazę testową zakłada się raz:

```bash
docker compose exec -T postgres psql -U dexarb -d dexarb -c "create database dexarb_test"
npm run db:migrate:test
```

Po klonie, bez `.env`, warstwy 2–4 same się pomijają i `npm run test` przechodzi na samych
testach jednostkowych.

## Struktura repo

```
packages/
  core/       # AMM, cechy S/G/L/M, modele, ewaluacja
  db/         # schemat Drizzle, migracje, createDb/createTestDb
  shared/     # DTO (zod) między api i web
  ingest/     # pobieranie zdarzeń Sync/Swap i bloków z RPC
  analysis/   # block_states, opportunities, weryfikacja, zbiór uczący ANFIS
  api/        # Fastify: trasy, zapytania, eksport wyników
  worker/     # kolejka jobs, handlery, planer macierzy par × okien
  web/        # dashboard React + Vite
docs/         # metodyka, ADR, glosariusz, słownik danych, źródła pracy
scripts/      # reproduce.sh i skrypty pomocnicze
results/      # wyniki eksportu
.github/      # workflow CI
```

## Dokumentacja

- [`docs/methodology.md`](docs/methodology.md) — dane, cechy, modele, etykiety, protokół ewaluacji.
- [`docs/konwencje.md`](docs/konwencje.md) — konwencje kodu, decyzje projektowe, komendy.
- [`docs/adr/README.md`](docs/adr/README.md) — decyzje projektowe (ADR) z kontekstem i konsekwencjami.
- [`docs/glossary.md`](docs/glossary.md) — glosariusz pojęć.
- [`docs/data-dictionary.md`](docs/data-dictionary.md) — słownik danych, generowany ze schematu.
- [`docs/verification-method.md`](docs/verification-method.md) — metoda i wyniki kontroli ręcznej.
- [`docs/anfis.md`](docs/anfis.md) — ANFIS, baseline v2, porównanie modeli.

## Zakres i bezpieczeństwo

To narzędzie lokalne. API nie ma uwierzytelniania, hasło Postgresa w `docker-compose.yml` nadaje
się wyłącznie do pracy na własnej maszynie, a dane dostępowe do węzła trzyma nieśledzony `.env`.
Poza zakresem projektu zostały Uniswap V3, inne sieci EVM, internacjonalizacja i WebSockety.

## Panel „Na żywo"

Opcjonalny widok próbkujący bieżący stan pul prosto z RPC, bez zapisu do bazy. Ocenia je tymi
samymi modelami co dane historyczne i trzyma godzinę historii w pamięci procesu API. Włącza go
`LIVE_ENABLED`, a bez `RPC_URL` pozostaje wyłączony.
