// @dex-arb/worker — wykonuje zadania z tabeli jobs.
// Uruchomienie: npm run start -w @dex-arb/worker (zmienne z .env: DATABASE_URL, RPC_URL,
// JOB_MAX_ATTEMPTS, WORKER_POLL_MS — patrz .env.example).
import { createDb } from "@dex-arb/db";
import { loadIngestEnv } from "@dex-arb/ingest";
import { buildHandlers } from "./handlers.js";
import { requeueOrphanedJobs, runLoop } from "./runner.js";

const { db, sql } = createDb();
const ac = new AbortController();

// Nieobsłużone odrzucenie obietnicy = błąd programisty (obietnica bez `await`/`catch`). Zamiast
// cichego „zombie" (Node domyślnie i tak kończy proces, ale bez naszego kontekstu i bez
// zamknięcia puli): logujemy głośno i wychodzimy z kodem != 0 — po restarcie `requeueOrphanedJobs`
// zwróci przerwane zadanie do kolejki.
process.on("unhandledRejection", (reason) => {
  console.error("BŁĄD KRYTYCZNY workera: nieobsłużone odrzucenie obietnicy:", reason);
  void sql.end({ timeout: 5 }).finally(() => process.exit(1));
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`\n${sig}: kończę po bieżącym zadaniu...`);
    ac.abort();
  });
}

// Przed pętlą zamiatamy zadania osierocone po twardej awarii poprzedniego procesu (kill -9/OOM)
// — zostały „running", bo nic ich wtedy nie oznaczyło z powrotem jako queued. Jeden worker →
// każde running zastane na starcie jest z definicji osierocone.
const requeued = await requeueOrphanedJobs(db);
if (requeued > 0) {
  console.log(`Wznowienie po starcie: ${requeued} zadanie(a) w stanie running (po twardej awarii) wróciło do queued.`);
}

runLoop(db, buildHandlers(db, loadIngestEnv()), {
  pollMs: Number(process.env.WORKER_POLL_MS ?? 2000),
  maxAttempts: Number(process.env.JOB_MAX_ATTEMPTS ?? 3),
  signal: ac.signal,
})
  .then(async () => {
    console.log("Worker zatrzymany.");
    await sql.end();
    process.exit(0);
  })
  .catch(async (e: unknown) => {
    console.error("BŁĄD KRYTYCZNY workera:", e);
    await sql.end();
    process.exit(1);
  });
