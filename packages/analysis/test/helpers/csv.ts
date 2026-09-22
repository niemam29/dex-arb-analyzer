/** Minimalny parser CSV (bez cudzysłowów/ucieczek) — wystarcza dla plików wygenerowanych
 * przez implementację referencyjną, które nie mają przecinków w polach. */
import * as fs from "node:fs";
import * as path from "node:path";

export function readCsv(file: string): Record<string, string>[] {
  const [head, ...lines] = fs.readFileSync(file, "utf8").trim().split("\n");
  const cols = head.split(",");
  return lines.map((l) => {
    const vals = l.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, vals[i] ?? ""]));
  });
}

/** Katalog danych referencyjnych; undefined => testy regresyjne pomijane. */
export const PROJECT_DATA = process.env.REFERENCE_DATA_DIR;
export const projectFile = (name: string) => path.join(PROJECT_DATA!, name);
