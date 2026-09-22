// Skrypt CLI: uruchamia analyzePairWindow bezpośrednio (bez kolejki `jobs`) — do ręcznych
// przebiegów i weryfikacji. .env ładowany przez `tsx --env-file=../../.env` (patrz
// package.json), tak jak seed w @dex-arb/ingest i skrypty w @dex-arb/worker.
// Uruchomienie: npm run analyze -w @dex-arb/analysis -- --pair <id> --window <id>
import { parseArgs } from "node:util";
import { createDb } from "@dex-arb/db";
import { analyzePairWindow } from "./analyzePairWindow.js";

const { values } = parseArgs({ options: { pair: { type: "string" }, window: { type: "string" } } });
if (!values.pair || !values.window) {
  console.error("użycie: npm run analyze -w @dex-arb/analysis -- --pair <id> --window <id>");
  process.exit(2);
}

async function main(): Promise<void> {
  const { db, sql } = createDb();
  const t0 = Date.now();
  try {
    const res = await analyzePairWindow(
      db,
      { pairId: Number(values.pair), windowId: Number(values.window) },
      {
        log: async (m) => console.log(m),
        progress: async (f) => {
          process.stdout.write(`\r${(100 * f).toFixed(0)} %   `);
        },
      },
    );
    console.log(`\n${JSON.stringify(res, null, 2)}\nCzas: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } finally {
    await sql.end();
  }
}

main().catch((e: unknown) => {
  console.error("BŁĄD:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
