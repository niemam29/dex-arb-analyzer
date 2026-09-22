// CLI: zapisuje docs/data-dictionary.md. Uruchomienie: npm run data-dictionary (root) — bez bazy.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderDataDictionary } from "./data-dictionary-render.js";

const target = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "data-dictionary.md");
writeFileSync(target, renderDataDictionary());
console.log(`zapisano ${target}`);
