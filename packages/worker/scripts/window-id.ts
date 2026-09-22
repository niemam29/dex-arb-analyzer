// Wypisuje `windows.id` dla nazwy okna (seed-data.ts) — reproduce.sh nie zakłada, że id = kolejność seeda.
import { createDb, schema } from "@dex-arb/db";
import { eq } from "drizzle-orm";

const name = process.argv[2];
if (!name) { console.error("użycie: window-id \"<nazwa okna>\""); process.exit(2); }
const { db, sql } = createDb();
try {
  const [w] = await db.select({ id: schema.windows.id }).from(schema.windows).where(eq(schema.windows.name, name));
  if (!w) { console.error(`brak okna „${name}"`); process.exitCode = 1; } else console.log(String(w.id));
} finally {
  await sql.end();
}
