import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Db = PostgresJsDatabase<typeof schema>;

/** Tworzy połączenie; url domyślnie z DATABASE_URL. Wywołujący zamyka przez sql.end(). */
export function createDb(url = process.env.DATABASE_URL): { db: Db; sql: postgres.Sql } {
  if (!url) throw new Error("Brak DATABASE_URL");
  const sql = postgres(url, { max: 8, prepare: false });
  return { db: drizzle(sql, { schema }), sql };
}

/**
 * Wspólny helper testów integracyjnych: łączy się WYŁĄCZNIE przez DATABASE_URL_TEST (nigdy nie
 * spada na DATABASE_URL — testy integracyjne robią TRUNCATE i nie mogą trafić w bazę dev/prod).
 * Odmawia połączenia, jeśli nazwa bazy w URL-u nie kończy się na „_test" — to ostatnia linia
 * obrony przed pomyłką w konfiguracji (np. skopiowaniem DATABASE_URL do DATABASE_URL_TEST).
 */
export function createTestDb(url = process.env.DATABASE_URL_TEST): { db: Db; sql: postgres.Sql } {
  if (!url) throw new Error("Brak DATABASE_URL_TEST");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `DATABASE_URL_TEST wskazuje na bazę „${dbName}", której nazwa nie kończy się na „_test" — ` +
        `odmawiam uruchomienia testów integracyjnych na tej bazie (ochrona bazy deweloperskiej/produkcyjnej).`,
    );
  }
  return createDb(url);
}
