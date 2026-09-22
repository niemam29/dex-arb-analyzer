// Czeka, aż kolejka `jobs` będzie pusta (brak queued/running). Używane przez scripts/reproduce.sh
// między etapami (macierz -> kalibracja -> treningi -> eksport). Kody wyjścia: 0 pusto i bez
// niepowodzeń; 1 pusto, ale są zadania `failed` o id > --since; 2 przekroczony --timeout-min.
// Uruchomienie: npm run jobs:wait-idle -w @dex-arb/worker -- [--since <jobId>] [--timeout-min 600] [--poll-s 10]
import { createDb } from "@dex-arb/db";
import { sql } from "drizzle-orm";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) return fallback;
  const n = Number(process.argv[i + 1]);
  if (!Number.isFinite(n)) {
    console.error(`wait-idle: ${name} musi być liczbą, otrzymano „${process.argv[i + 1]}"`);
    process.exit(2);
  }
  return n;
}
const since = arg("--since", 0);
const timeoutMin = arg("--timeout-min", 600);
const pollS = arg("--poll-s", 10);

async function main(): Promise<number> {
  const { db, sql: client } = createDb();
  const deadline = Date.now() + timeoutMin * 60_000;
  try {
    for (;;) {
      const [active] = (await db.execute(sql`SELECT count(*)::int AS n FROM jobs WHERE status IN ('queued','running')`)) as unknown as { n: number }[];
      if (active!.n === 0) break;
      if (Date.now() > deadline) {
        console.error(`wait-idle: limit ${timeoutMin} min przekroczony, aktywnych zadań: ${active!.n}`);
        return 2;
      }
      process.stderr.write(`wait-idle: aktywne ${active!.n} … ${new Date().toISOString()}\n`);
      await new Promise((r) => setTimeout(r, pollS * 1000));
    }
    const failed = (await db.execute(sql`SELECT id, type, error FROM jobs WHERE status = 'failed' AND id > ${since} ORDER BY id`)) as unknown as { id: number; type: string; error: string | null }[];
    for (const f of failed) console.error(`FAILED #${f.id} ${f.type}: ${f.error ?? ""}`);
    return failed.length > 0 ? 1 : 0;
  } finally {
    await client.end();
  }
}

main().then((code) => { process.exitCode = code; }).catch((e: unknown) => { console.error("BŁĄD:", e instanceof Error ? e.message : String(e)); process.exitCode = 2; });
