// Skrypt CLI: ponownie zleca (kolejkuje) zadanie po `id`. Przydatne po naprawie
// przyczyny błędu (np. chwilowa awaria RPC) bez usuwania wpisu z historii `jobs`. Brama i reset
// pól — patrz `../src/retryJob.ts` (ta sama brama status='failed' co API POST /jobs/:id/retry,
// packages/api/src/routes/jobs.ts — bez tej bramy ten skrypt, w przeciwieństwie do API,
// ponawiałby z DOWOLNEGO statusu i nie czyściłby finished_at/progress).
// Uruchomienie: npm run jobs:retry -w @dex-arb/worker -- <id>
// .env ładowany przez `tsx --env-file=../../.env` (patrz package.json).
import { createDb } from "@dex-arb/db";
import { retryJob } from "../src/retryJob.js";

const id = Number(process.argv[2]);
if (!id || !Number.isInteger(id) || id <= 0) {
  console.error("użycie: jobs:retry <id>");
  process.exit(2);
}

async function main(): Promise<void> {
  const { db, sql } = createDb();
  try {
    await retryJob(db, id);
    console.log(`zadanie ${id} ponownie w kolejce`);
  } finally {
    await sql.end();
  }
}

main().catch((e: unknown) => {
  console.error("BŁĄD:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
