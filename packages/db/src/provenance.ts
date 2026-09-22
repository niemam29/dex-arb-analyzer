// Prymitywy proweniencji wyników (git SHA, wersje pakietów, host RPC bez poświadczeń, liczności
// tabel). Mieszkają w `db`, bo to wspólna zależność `analysis` (blok `provenance` w
// scoring_models.metrics) i `api` (`export-results` → results/provenance.json).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { Db } from "./client.js";

/** `git rev-parse HEAD` albo "unknown" (brak gita / poza repozytorium). */
export function gitSha(cwd: string = process.cwd()): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

/** Wersja pakietu z `node_modules/<name>/package.json` szukanego w górę od tego pliku (hoisting
 * workspaces) — `createRequire` nie działa dla pakietów z polem `exports` bez `./package.json`. */
export function packageVersion(name: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) {
      try {
        return (JSON.parse(readFileSync(candidate, "utf8")) as { version?: string }).version ?? "unknown";
      } catch {
        return "unknown";
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "unknown";
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/** Nazwy hostów nieidentyfikujące infrastruktury same z siebie (lokalne/wewnętrzne DNS). */
const PRIVATE_SUFFIXES = [".local", ".internal", ".lan", ".home.arpa"];

/** `true`, gdy `hostname` (z `new URL().hostname`, bez nawiasów `[]` dla IPv6) jest literałem IP
 * (v4 lub v6) albo hostem prywatnym/wewnętrznym (localhost, `.local`/`.internal`/`.lan`, brak kropki
 * — nazwa maszyny bez domeny). Takie hosty NIE mają "registrable domain" wartego pokazania. */
function isNonIdentifying(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "");
  if (h === "localhost") return true;
  if (IPV4.test(h)) return true;
  if (h.includes(":")) return true; // IPv6 literal — domeny nigdy nie niosą ":"
  if (PRIVATE_SUFFIXES.some((suf) => h.endsWith(suf))) return true;
  if (!h.includes(".")) return true; // pojedyncza etykieta — nazwa maszyny, nie domena publiczna
  return false;
}

/** Zamaskowana, nieidentyfikująca etykieta hosta RPC z URL-a (bez schematu, portu, ścieżki,
 * poświadczeń): `"self-hosted"` dla literału IP / hosta prywatnego (patrz `isNonIdentifying`), w
 * przeciwnym razie zarejestrowana domena z pierwszą etykietą zamaskowaną (`rpc.example.org` ->
 * `*.example.org`; bez subdomeny, np. `example.org`, zwracane bez zmian — nie ma czego maskować).
 * `null`, gdy brak/niepoprawny URL. */
export function rpcHostFrom(url: string | undefined): string | null {
  if (!url) return null;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  if (!hostname) return null;
  if (isNonIdentifying(hostname)) return "self-hosted";
  const labels = hostname.split(".");
  if (labels.length <= 2) return hostname;
  return `*.${labels.slice(-2).join(".")}`;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** `count(*)` dla podanych tabel (nazwy walidowane, bo idą do SQL jako identyfikatory). */
export async function tableCounts(db: Db, tables: readonly string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tables) {
    if (!IDENT.test(t)) throw new Error(`tableCounts: niepoprawna nazwa tabeli „${t}"`);
    const rows = (await db.execute(sql`SELECT count(*)::text AS n FROM ${sql.identifier(t)}`)) as unknown as { n: string }[];
    out[t] = Number(rows[0]?.n ?? 0);
  }
  return out;
}
