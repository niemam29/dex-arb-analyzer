// Szkielet Fastify: buildApp({ db }) tworzy instancję niezależną od globalnego
// singletona `db` — testy przekazują połączenie z bazy testowej (`test/helpers/db.ts`), a
// `server.ts` (proces produkcyjny/dev) przekazuje `createDb()` z `@dex-arb/db`.
import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "@dex-arb/db";
import type { LiveStoreLike } from "@dex-arb/shared";
import { ZodError } from "zod";
import { HttpError } from "./plugins/zod.js";
import { catalogRoutes } from "./routes/catalog.js";
import { coverageRoutes } from "./routes/coverage.js";
import { jobRoutes } from "./routes/jobs.js";
import { liveRoutes } from "./routes/live.js";
import { modelRoutes } from "./routes/models.js";
import { opportunitiesRoutes } from "./routes/opportunities.js";
import { seriesRoutes } from "./routes/series.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    /** magazyn panelu na żywo; null gdy LIVE_ENABLED=false albo w testach bez pollera */
    live: LiveStoreLike | null;
  }
}

/** Minimalny kontrakt klienta postgres-js potrzebny do zamknięcia połączenia (`createDb().sql`). */
export interface ClosableSql {
  end(): Promise<unknown>;
}

export interface AppOptions {
  db: Db;
  logger?: boolean;
  /**
   * Klient SQL do zamknięcia (`createDb().sql`) — jeśli podany, rejestrowany jest hook
   * `onClose`, więc `app.close()` sam zamyka połączenie z bazą.
   */
  sql?: ClosableSql;
  /**
   * Magazyn próbek panelu na żywo (`LiveStore` z `@dex-arb/analysis`, składany w server.ts).
   * Brak = tryb wyłączony: GET /live zwraca `enabled: false`. Testy podają atrapę `LiveStoreLike`.
   */
  live?: LiveStoreLike | undefined;
}

export function buildApp({ db, logger = false, sql, live }: AppOptions): FastifyInstance {
  const app = Fastify({ logger });
  app.decorate("db", db);
  app.decorate("live", live ?? null);

  if (sql) {
    app.addHook("onClose", async () => {
      await sql.end();
    });
  }

  app.setErrorHandler((err, request, reply) => {
    // HttpError z `parseOr400` = walidacja WEJŚCIA (błąd klienta) → 400.
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.message, issues: err.issues });
    }
    // Goły ZodError, który NIE przeszedł przez `parseOr400`, pochodzi z kontroli kontraktu
    // WYJŚCIA (np. `PairList.parse(rows)` w catalog.ts) — to niezgodność SQL ↔ DTO, czyli błąd
    // serwera, a nie klienta. Nie mapujemy go na 400 i nie ujawniamy szczegółów zod w body.
    if (err instanceof ZodError) {
      request.log.error({ err }, "Niezgodność kontraktu odpowiedzi");
      return reply.status(500).send({ error: "Niezgodność kontraktu odpowiedzi" });
    }
    // Błędy własne Fastify (parsowanie body — FST_ERR_CTP_*, limit rozmiaru, nieobsługiwany
    // content-type itd.) niosą numeryczny `statusCode` z zakresu klienta (4xx) — to błąd
    // żądania, nie serwera, więc oddajemy ten status zamiast maskować go jako 500.
    // `err` jest typu `unknown` (domyślny typ Fastify) — zawężamy przez `instanceof Error`,
    // żeby bezpiecznie odczytać `.message`; `statusCode` nie jest częścią typu `Error`,
    // więc doczytujemy go rzutowaniem.
    if (err instanceof Error) {
      const statusCode = (err as { statusCode?: unknown }).statusCode;
      if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
        return reply.status(statusCode).send({ error: `Niepoprawne żądanie: ${err.message}` });
      }
    }
    app.log.error(err);
    return reply.status(500).send({ error: "Błąd serwera" });
  });

  app.setNotFoundHandler((_req, reply) => {
    return reply.status(404).send({ error: "Nie znaleziono zasobu" });
  });

  app.get("/health", async () => ({ ok: true }));

  app.register(catalogRoutes);
  app.register(coverageRoutes);
  app.register(jobRoutes);
  app.register(liveRoutes);
  app.register(modelRoutes);
  app.register(opportunitiesRoutes);
  app.register(seriesRoutes);

  return app;
}
