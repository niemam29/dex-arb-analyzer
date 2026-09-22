import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDb } from "./client.js";

const { db, sql } = createDb();
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
await migrate(db, { migrationsFolder });
console.log("Migracje zastosowane:", migrationsFolder);
await sql.end();
