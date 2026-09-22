// Trasy zadań kolejki: POST /jobs, GET /jobs, GET /jobs/:id,
// POST /jobs/:id/retry. `JobDto.parse(...)`/`JobList.parse(...)` po stronie serwera to celowa
// kontrola kontraktu, jak w routes/catalog.ts i routes/coverage.ts. Logika tworzenia zadania
// (walidacja referencji, dedup 409) jest w `../jobs.js` — reużywana przez
// `routes/models.ts` (POST /models/anfis/train), patrz komentarz tam.
import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { JOB_STATUSES, JOB_TYPES, JobCreate, JobDto, JobList } from "@dex-arb/shared";
import { HttpError, parseOr400 } from "../plugins/zod.js";
import { assertRefsExist, createJob, JOB_COLUMNS } from "../jobs.js";

// `.strict()`: nieznany klucz query -> 400 (literówka w nazwie filtra nie zwraca cicho pełnej
// listy), spójnie z EvaluationQuery/SeriesQuery/OpportunityListQuery.
const ListQuery = z
  .object({
    status: z.enum(JOB_STATUSES).optional(),
    type: z.enum(JOB_TYPES).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(50),
  })
  .strict();
const IdParam = z.object({ id: z.coerce.number().int().positive() });

export const jobRoutes: FastifyPluginAsync = async (app) => {
  app.post("/jobs", async (req, reply) => {
    const body = parseOr400(JobCreate, req.body);
    await assertRefsExist(app.db, body);
    const result = await createJob(app.db, body);
    if (result.status === 409) {
      return reply.status(409).send({ error: "Takie zadanie już czeka lub jest w toku", job: result.job });
    }
    return reply.status(201).send(result.job);
  });

  app.get("/jobs", async (req) => {
    const { status, type, limit } = parseOr400(ListQuery, req.query);
    const conditions = [];
    if (status) conditions.push(sql`status = ${status}`);
    if (type) conditions.push(sql`type = ${type}`);
    const where = conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
    const rows = await app.db.execute(sql`
      SELECT ${JOB_COLUMNS} FROM jobs ${where} ORDER BY id DESC LIMIT ${limit}
    `);
    return JobList.parse(rows);
  });

  app.get("/jobs/:id", async (req) => {
    const { id } = parseOr400(IdParam, req.params);
    const rows = (await app.db.execute(sql`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ${id}`)) as unknown[];
    if (rows.length === 0) throw new HttpError(404, `Zadanie o id=${id} nie istnieje`);
    return JobDto.parse(rows[0]);
  });

  // Ponowne zlecenie zadania po naprawie przyczyny błędu — te same semantyki co CLI
  // `jobs:retry` (packages/worker/scripts/retry.ts): status='queued', attempts=0, error=null.
  // finished_at/progress też wracają do stanu "świeżo zakolejkowanego" (finished_at=null,
  // progress=0) — inaczej zadanie widoczne jest jako 'queued', ale dashboard nadal pokazuje
  // stary czas zakończenia i postęp z poprzedniej, nieudanej próby. `log` zostaje — to historia
  // dotychczasowych prób, przydatna przy diagnozie, nie stan bieżący. W przeciwieństwie do CLI
  // (które nie sprawdza obecnego statusu) API dopuszcza retry tylko z 'failed' — inaczej 409.
  app.post("/jobs/:id/retry", async (req, reply) => {
    const { id } = parseOr400(IdParam, req.params);
    const rows = (await app.db.execute(sql`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ${id}`)) as unknown[];
    if (rows.length === 0) throw new HttpError(404, `Zadanie o id=${id} nie istnieje`);
    const job = JobDto.parse(rows[0]);
    if (job.status !== "failed") {
      return reply.status(409).send({ error: "Zadanie można ponowić tylko ze statusu failed", job });
    }
    const updated = (await app.db.execute(sql`
      UPDATE jobs SET status = 'queued', attempts = 0, error = null, finished_at = null, progress = 0
      WHERE id = ${id}
      RETURNING ${JOB_COLUMNS}
    `)) as unknown[];
    return JobDto.parse(updated[0]);
  });
};
