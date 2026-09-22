// Nagrywa surową odpowiedź eth_getTransactionReceipt do packages/analysis/test/fixtures/receipts/<hash>.json,
// żeby testy dowodowe heurystyk (known-tx.test.ts) działały offline i w CI. Wymaga RPC_URL (archiwalny).
// Uruchomienie: npx tsx --env-file=.env scripts/record-receipt.ts <hash> [<hash> …]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RpcClient, loadIngestEnv } from "@dex-arb/ingest";

const hashes = process.argv.slice(2).map((h) => h.toLowerCase());
if (hashes.length === 0) {
  console.error("użycie: record-receipt.ts <hash…>");
  process.exit(2);
}
const dir = join(process.cwd(), "packages", "analysis", "test", "fixtures", "receipts");
mkdirSync(dir, { recursive: true });
const rpc = new RpcClient({ urls: loadIngestEnv().rpcUrls });
const raws = await rpc.batch<unknown>(hashes.map((h) => ({ method: "eth_getTransactionReceipt", params: [h] })));
raws.forEach((raw, i) => {
  if (!raw) throw new Error(`brak receiptu ${hashes[i]}`);
  const file = join(dir, `${hashes[i]}.json`);
  writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
  console.log(`zapisano ${file}`);
});
