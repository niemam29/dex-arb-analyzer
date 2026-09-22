// Skrypt CLI: zleca nowe zadanie do kolejki `jobs`.
// Uruchomienie: npm run jobs:enqueue -w @dex-arb/worker -- <type> '<json params>'
// Parametry walidowane przez parseJobParams (ten sam schemat zod, którego używa runner) — błąd
// walidacji jest zgłaszany od razu przy zlecaniu, a nie dopiero przy wykonaniu przez workera.
// .env ładowany przez `tsx --env-file=../../.env` (patrz package.json), tak jak seed w @dex-arb/ingest.
import { createDb, schema } from "@dex-arb/db";
import { parseJobParams, JOB_TYPES, type JobType } from "@dex-arb/shared";

const [type, json] = process.argv.slice(2);
if (!type) {
  console.error("użycie: jobs:enqueue <type> '<json params>'");
  process.exit(2);
}
if (!(JOB_TYPES as readonly string[]).includes(type)) {
  console.error(`nieznany typ zadania: ${type} (dostępne: ${JOB_TYPES.join(", ")})`);
  process.exit(2);
}
const jobType = type as JobType;

async function main(): Promise<void> {
  const params = parseJobParams(jobType, JSON.parse(json ?? "{}"));
  const { db, sql } = createDb();
  try {
    const [job] = await db.insert(schema.jobs).values({ type: jobType, params }).returning();
    console.log(`zlecono zadanie id=${job!.id} (${jobType})`);
  } finally {
    await sql.end();
  }
}

main().catch((e: unknown) => {
  console.error("BŁĄD:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
