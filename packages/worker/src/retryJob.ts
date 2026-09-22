// Logika ponownego zlecenia (retry) zadania z kolejki `jobs` (brama
// status='failed' i reset finished_at/progress). Wydzielona
// z `scripts/retry.ts`, żeby była testowalna (scripts/ nie jest objęte typecheckiem/testami
// pakietu — patrz tsconfig.json) i współdzielona logicznie z bramą API POST /jobs/:id/retry
// (packages/api/src/routes/jobs.ts, ta sama reguła: retry tylko ze statusu 'failed').
import { eq } from "drizzle-orm";
import { schema, type Db } from "@dex-arb/db";

export class RetryNotAllowedError extends Error {}

/**
 * Ponownie kolejkuje zadanie `id` — WYŁĄCZNIE ze statusu 'failed' (inaczej `RetryNotAllowedError`
 * z polskim komunikatem, wiersz bez zmian). Reset przy sukcesie: status='queued', attempts=0,
 * error=null, finished_at=NULL, progress=0 — zadanie startuje czysto, tak jak świeżo zlecone
 * (log NIE jest czyszczony — zostaje historia poprzednich prób).
 */
export async function retryJob(db: Db, id: number): Promise<void> {
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
  if (!job) throw new RetryNotAllowedError(`brak zadania id=${id}`);
  if (job.status !== "failed") {
    throw new RetryNotAllowedError(`zadanie ${id} można ponowić tylko ze statusu failed (obecny status: ${job.status})`);
  }
  await db
    .update(schema.jobs)
    .set({ status: "queued", attempts: 0, error: null, finishedAt: null, progress: 0 })
    .where(eq(schema.jobs.id, id));
}
