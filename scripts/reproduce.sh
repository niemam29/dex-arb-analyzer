#!/usr/bin/env bash
# Reprodukcja wyników pracy od zera: baza -> migracje -> seed -> macierz ingest/analyze/verify ->
# kalibracja baseline v2 -> 10 treningów ANFIS (2 konfiguracje × seedy 42–46) -> eksport tabel ->
# słownik danych. Wymaga: Docker, Node 20, .env z DATABASE_URL i ARCHIWALNYM RPC_URL (okna z 2021–22).
# Szacowany czas (Mac M1, eRPC): macierz 8 pul × 4 okna ingest + 16 analyze + 16 verify = 64 zadania
# (planMatrix, packages/worker/src/matrix/plan.ts) ≈ 6-7 h łącznie (--skip-ingest gdy dane są),
# kalibracja ≈ 1 min, 10 treningów ≈ 10–30 min, eksport ≈ 2 min.
# Użycie: bash scripts/reproduce.sh [--skip-ingest]
set -euo pipefail
cd "$(dirname "$0")/.."
SKIP_INGEST=0
for a in "$@"; do [ "$a" = "--skip-ingest" ] && SKIP_INGEST=1; done
[ -f .env ] || { echo "Brak .env (cp .env.example .env i uzupełnij RPC_URL)"; exit 1; }
set -a; source .env; set +a
[ -n "${RPC_URL:-}" ] || { echo "RPC_URL puste"; exit 2; }
mkdir -p results

echo "== baza, migracje, seed"
npm run db:up
npm run db:migrate
npm run db:seed

echo "== worker w tle (log: results/worker.log)"
# `npm run start -w ...` uruchamia tsx jako podproces npm — kill PID-u npm w trap nie zatrzymuje
# workera. `exec` w podpowłoce zastępuje ją procesem tsx, więc WORKER_PID to bezpośrednio jego PID.
(cd packages/worker && exec npx tsx --env-file=../../.env src/index.ts) >results/worker.log 2>&1 &
WORKER_PID=$!
trap 'kill "$WORKER_PID" 2>/dev/null || true' EXIT
sleep 3

enqueue() {
  local id
  id=$(npm run -s jobs:enqueue -w @dex-arb/worker -- "$1" "$2" | sed -n 's/.*id=\([0-9]*\).*/\1/p')
  if [ -z "$id" ]; then
    echo "BŁĄD: jobs:enqueue nie zwróciło id dla '$1' '$2'" >&2
    exit 1
  fi
  echo "$id"
}
wait_idle() { npm run -s jobs:wait-idle -w @dex-arb/worker -- --since "$1" --timeout-min "$2"; }
wid() { npm run -s window-id -w @dex-arb/worker -- "$1"; }

if [ "$SKIP_INGEST" = 0 ]; then
  echo "== macierz 4 pary × 4 okna (ingest -> analyze -> verify)"
  # --since 0: reprodukcja startuje na świeżej bazie, więc każde `failed` pochodzi z tego przebiegu.
  npm run matrix -w @dex-arb/worker
  wait_idle 0 720
fi

W2=$(wid "2021-05 krach"); W3=$(wid "2021-11 ATH"); W4=$(wid "2022-05 Luna"); W5=$(wid "2022-11 FTX")
echo "== kalibracja baseline v2 (train W$W2, holdout W$W3+W$W4+W$W5)"
FIRST=$(enqueue "calibrate:baseline_v2" "{\"trainWindows\":[$W2],\"testWindows\":[$W3,$W4,$W5],\"name\":\"baseline_v2\"}")
wait_idle "$((FIRST - 1))" 30

echo "== ANFIS: 2 konfiguracje × seedy 42–46"
for SEED in 42 43 44 45 46; do
  enqueue train "{\"trainWindows\":[$W2],\"testWindows\":[$W3,$W4,$W5],\"seed\":$SEED,\"epochs\":200,\"lr\":0.01,\"excludeK0\":false,\"name\":\"anfis-w2\"}"
  enqueue train "{\"trainWindows\":[$W2,$W4],\"testWindows\":[$W3,$W5],\"seed\":$SEED,\"epochs\":200,\"lr\":0.01,\"excludeK0\":false,\"name\":\"anfis-w2w4\"}"
done
wait_idle "$((FIRST - 1))" 180

echo "== eksport wyników i słownik danych"
npm run export-results -- --latex
npm run data-dictionary
echo "Gotowe: results/, docs/data-dictionary.md"
