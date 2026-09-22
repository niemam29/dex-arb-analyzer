# ADR 0001: RPC jako jedyne źródło danych; zewnętrzny CSV odrzucony

**Status:** przyjęty · **Data:** 2026-08-26 · **Dotyczy:** `packages/ingest/src/jobs/{ingest-pool-window,import-csv}.ts`, `packages/analysis/src/db.ts` (`ensureIngestComplete`)

## Kontekst
Przygotowany wcześniej zbiór `events.csv` (279 370 zdarzeń Sync/Swap WETH/USDC, 14–26 maja
2021) był kuszącym źródłem startowym. Analiza pliku wykazała, że 12 004 wiersze mają `logIndex`
uszkodzony przepełnieniem uint32 (wartości ~4 294 967 29x zamiast indeksów < ~1200). Kolejność logów
w bloku decyduje o tym, który `Sync` jest „ostatnim stanem" bloku, więc uszkodzony `logIndex` psuje
odtwarzanie rezerw w części bloków — stąd nie jest to kosmetyczna wada, tylko ryzyko cichego
przekłamania cech S/G/L/M dla nieznanego podzbioru bloków.

## Decyzja
Jedynym źródłem danych dla baz docelowych jest ingest z archiwalnego RPC (`eth_getLogs` w chunkach,
wznawialny przez `ingest_ranges`). Handler `import:csv` pozostaje wyłącznie jako pomocnicza ścieżka
importu: pomija wiersze z uszkodzonym `logIndex` (próg 1 000 000, komentarz nagłówka
`import-csv.ts`), nie poszerza kolumny `log_index` do `bigint`, żeby nie kolidować z docelowym
re-ingestem RPC tego samego okna (ten sam klucz główny `(pool_id, block, log_index)` musi się
zgadzać z prawdziwymi wartościami z łańcucha). Analiza pary wymaga 100% pokrycia obu pul przez
`ingest_ranges` — bramkę implementuje `ensureIngestComplete` (`packages/analysis/src/db.ts`), która
rzuca błąd z listą brakujących pul, jeśli którakolwiek nie osiągnęła pełnego pokrycia okna.

## Konsekwencje
+ Dane odtwarzalne z łańcucha przez każdego z dostępem do węzła archiwalnego (`scripts/reproduce.sh`).
+ Autorytatywnym źródłem dla wszystkich czterech okien analizy (`docs/methodology.md` §1) jest
  wyłącznie RPC — brak ryzyka cichego przekłamania cech z uszkodzonych rekordów CSV.
− Pełna macierz par × okien wymaga wielogodzinnego ingestu i węzła archiwalnego (`RPC_URL`) — droższe
  niż jednorazowy import CSV.
− Liczby tej pracy (np. liczności okazji, etykiety) różnią się od wcześniejszych wyliczeń na CSV —
  wyjaśnione jakością źródła, nie zmianą metody oceny.

## Alternatywy odrzucone
- Naprawa CSV przez re-sortowanie wierszy po `txHash`/pozycji w pliku — brak gwarancji, że taka
  kolejność odtwarza rzeczywistą kolejność logów w bloku.
- Import CSV z „dosypaniem" brakujących/uszkodzonych pól z RPC — dwa źródła tego samego okna w jednej
  bazie, nieodtwarzalne i trudne do audytu (który wiersz pochodzi skąd).
