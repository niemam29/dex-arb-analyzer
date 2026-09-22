// Pętla workera: pobiera kolejne zadania z `jobs` (FOR UPDATE SKIP LOCKED), wykonuje
// handler z rejestru, zapisuje log/progress i obsługuje retry z backoffem / oznaczenie failed.
import { schema, type Db } from "@dex-arb/db";
import { eq, sql } from "drizzle-orm";
import { parseJobParams, type JobContext, type JobType } from "@dex-arb/shared";
import type { HandlerRegistry, JobRow } from "./types.js";

/** Znacznik czasu linii logu w formacie [HH:MM:SS] (UTC — spójne niezależnie od strefy hosta). */
const ts = (): string => new Date().toISOString().slice(11, 19);

/** Jak często (ms) najwyżej zapisywać ctx.progress — throttling, żeby nie zalewać bazy update'ami. */
const PROGRESS_THROTTLE_MS = 500;

/**
 * Zadanie, które zostało `running` po twardej awarii workera (kill -9, OOM, restart hosta —
 * bez łagodnego SIGINT/SIGTERM), nigdy samo nie wraca do `queued` — `claimNextJob` bierze
 * tylko `status='queued'`. Przy jednym workerze każde `running` zastane na starcie jest z
 * definicji osierocone (żaden proces go teraz nie wykonuje), więc bezpiecznie zamiatamy je
 * z powrotem do `queued` — bez zwiększania `attempts` (to nie była nieudana próba wykonania,
 * tylko przerwany proces).
 */
export async function requeueOrphanedJobs(db: Db): Promise<number> {
  const rows = await db.execute(sql`UPDATE jobs SET status = 'queued' WHERE status = 'running' RETURNING id`);
  return (rows as unknown as { id: number }[]).length;
}

/**
 * Atomowo bierze najstarsze zadanie `queued` (FOR UPDATE SKIP LOCKED — bezpieczne przy wielu
 * workerach), oznacza je `running`, ustawia `started_at` i zwiększa `attempts` o 1. Zwraca `null`,
 * gdy nie ma nic do wzięcia (albo wszystko zajęte przez inne workery).
 */
export async function claimNextJob(db: Db): Promise<JobRow | null> {
  const rows = await db.execute<JobRow>(sql`
    UPDATE jobs SET status = 'running', started_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, params, status, progress, log, error, attempts,
              created_at AS "createdAt", started_at AS "startedAt", finished_at AS "finishedAt"
  `);
  return (rows as unknown as JobRow[])[0] ?? null;
}

/**
 * Kontekst zadania. `log`/`progress` są tylko telemetrią — błąd zapisu do bazy (chwilowy zanik
 * połączenia itp.) NIE może wywrócić handlera ani, gdy wywołujący nie czeka na obietnicę,
 * zabić workera nieobsłużonym odrzuceniem; jest logowany na stderr i połykany.
 */
function makeContext(db: Db, jobId: number, signal: AbortSignal): JobContext {
  let lastProgressAt = 0;
  const warn = (what: string, e: unknown): void => {
    console.warn(`job ${jobId}: nie udało się zapisać ${what}:`, e instanceof Error ? e.message : e);
  };
  return {
    jobId,
    signal,
    async log(msg: string) {
      const line = `[${ts()}] ${msg}\n`;
      try {
        await db
          .update(schema.jobs)
          .set({ log: sql`${schema.jobs.log} || ${line}` })
          .where(eq(schema.jobs.id, jobId));
      } catch (e) {
        warn("logu", e);
      }
    },
    async progress(fraction: number) {
      const clamped = Math.max(0, Math.min(1, fraction));
      const now = Date.now();
      // 100% zawsze zapisujemy (koniec zadania); pośrednie wartości — nie częściej niż co 500 ms.
      if (clamped < 1 && now - lastProgressAt < PROGRESS_THROTTLE_MS) return;
      lastProgressAt = now;
      try {
        await db
          .update(schema.jobs)
          .set({ progress: Math.round(clamped * 100) })
          .where(eq(schema.jobs.id, jobId));
      } catch (e) {
        warn("postępu", e);
      }
    },
  };
}

export async function runJob(
  db: Db,
  job: JobRow,
  handlers: HandlerRegistry,
  opts: { maxAttempts: number; signal: AbortSignal },
): Promise<"done" | "requeued" | "failed"> {
  const ctx = makeContext(db, job.id, opts.signal);

  const fail = async (msg: string): Promise<"failed"> => {
    await db
      .update(schema.jobs)
      .set({ status: "failed", error: msg, finishedAt: new Date() })
      .where(eq(schema.jobs.id, job.id));
    await ctx.log(`BŁĄD: ${msg}`);
    return "failed";
  };

  let params: unknown;
  try {
    params = parseJobParams(job.type as JobType, job.params);
  } catch (e) {
    return fail(`nieprawidłowe parametry zadania: ${(e as Error).message}`);
  }

  const handler = handlers[job.type];
  if (!handler) return fail(`brak handlera dla typu ${job.type}`);

  try {
    await ctx.log(`start (próba ${job.attempts}/${opts.maxAttempts})`);
    await handler(params, ctx);
    await db
      .update(schema.jobs)
      .set({ status: "done", progress: 100, finishedAt: new Date(), error: null })
      .where(eq(schema.jobs.id, job.id));
    return "done";
  } catch (e) {
    // Przerwanie kooperacyjnym sygnałem (SIGTERM/SIGINT → handler obserwuje ctx.signal i rzuca
    // "Przerwano") to NIE jest nieudana próba wykonania — to celowe zatrzymanie workera w
    // połowie zadania. Nie powinno więc obciążać budżetu JOB_MAX_ATTEMPTS ani zostawiać
    // komunikatu błędu w jobs.error. attempts cofamy o 1 (do wartości sprzed claimNextJob),
    // żeby kolejna próba (po restarcie workera) miała pełny budżet.
    if (opts.signal.aborted) {
      await ctx.log(`przerwano sygnałem; wrócił do kolejki`);
      await db
        .update(schema.jobs)
        .set({ status: "queued", attempts: sql`${schema.jobs.attempts} - 1` })
        .where(eq(schema.jobs.id, job.id));
      return "requeued";
    }

    const msg = e instanceof Error ? e.message : String(e);
    if (job.attempts < opts.maxAttempts) {
      await ctx.log(`próba ${job.attempts}/${opts.maxAttempts} nieudana: ${msg}; ponawiam`);
      await db.update(schema.jobs).set({ status: "queued", error: msg }).where(eq(schema.jobs.id, job.id));
      return "requeued";
    }
    return fail(msg);
  }
}

export async function runLoop(
  db: Db,
  handlers: HandlerRegistry,
  opts: { pollMs: number; maxAttempts: number; signal: AbortSignal },
): Promise<void> {
  // sleep przerywalny sygnałem — pozwala natychmiast zakończyć pętlę przy SIGINT/SIGTERM zamiast
  // czekać do końca bieżącego interwału odpytywania/backoffu.
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      opts.signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
    });

  while (!opts.signal.aborted) {
    const job = await claimNextJob(db);
    if (!job) {
      await sleep(opts.pollMs);
      continue;
    }
    const result = await runJob(db, job, handlers, opts);
    // prosty backoff: po nieudanej próbie odczekaj dłużej niż zwykły interwał odpytywania, zanim
    // pętla znów sięgnie po (być może to samo) zadanie.
    if (result === "requeued") await sleep(opts.pollMs * 2 ** job.attempts);
  }
}
