// Skrypt CLI: seeduje konfigurację (2 DEX-y, 5 tokenów, 4 pary, 8 pul, 4 okna) do bazy.
// Uruchomienie: npm run seed -w @dex-arb/ingest -- [--verify]
//   --verify   potwierdza adresy pul przez factory.getPair() oraz token0()/token1() na RPC
//              (adresy RPC z .env — RPC_URL/RPC_FALLBACK_URLS, patrz loadIngestEnv). Bez --verify
//              seed używa adresów z src/seed-data.ts wprost (wymaga, by były już wypełnione).
// .env ładowany przez `tsx --env-file=../../.env` (patrz package.json), tak jak w @dex-arb/db.
import { createDb } from "@dex-arb/db";
import { loadIngestEnv } from "../src/env.js";
import { RpcClient } from "../src/rpc/client.js";
import { runSeed } from "../src/seed.js";

const verify = process.argv.includes("--verify");

async function main(): Promise<void> {
  const { db, sql } = createDb();
  const rpc = verify ? new RpcClient({ urls: loadIngestEnv().rpcUrls }) : null;
  try {
    const results = await runSeed(db, rpc, { verify });
    for (const r of results) {
      console.log(`${r.status.padEnd(10)} ${r.dex.padEnd(10)} ${r.pair.padEnd(9)} ${r.address}  token0=${r.token0} token1=${r.token1}`);
    }
    console.log("Seed zakończony.");
  } finally {
    await sql.end();
  }
}

main().catch((e: unknown) => {
  console.error("BŁĄD:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
