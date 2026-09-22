// Logika tworzenia zadań kolejki, współdzielona przez `routes/jobs.ts` (POST /jobs) i
// `routes/models.ts` (POST /models/anfis/train) — wydzielona z
// `routes/jobs.ts`, żeby oba miejsca insertowały joby TĄ SAMĄ ścieżką (walidacja referencji,
// dedup 409, obsługa wyścigu na indeksie unikalnym częściowym).
import { sql } from "drizzle-orm";
import type { Db } from "@dex-arb/db";
import { JobDto, type JobCreate } from "@dex-arb/shared";
import { HttpError } from "./plugins/zod.js";

// jobs.created_at/started_at/finished_at to timestamptz — formatowane na ISO string tak samo
// jak w routes/catalog.ts (JobDto.created_at itd. to z.string(), JSON nie ma typu daty).
export const JOB_COLUMNS = sql`id, type, params, status, progress, log, error, attempts,
  to_char(created_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  to_char(started_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS started_at,
  to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS finished_at`;

export async function assertPoolExists(db: Db, id: number): Promise<void> {
  const rows = (await db.execute(sql`SELECT 1 FROM pools WHERE id = ${id}`)) as unknown[];
  if (rows.length === 0) throw new HttpError(404, `Pula o id=${id} nie istnieje`);
}
export async function assertPairExists(db: Db, id: number): Promise<void> {
  const rows = (await db.execute(sql`SELECT 1 FROM pairs WHERE id = ${id}`)) as unknown[];
  if (rows.length === 0) throw new HttpError(404, `Para o id=${id} nie istnieje`);
}
export async function assertWindowExists(db: Db, id: number): Promise<void> {
  const rows = (await db.execute(sql`SELECT 1 FROM windows WHERE id = ${id}`)) as unknown[];
  if (rows.length === 0) throw new HttpError(404, `Okno o id=${id} nie istnieje`);
}
/**
 * Okna treningowe/kalibracyjne i testowe muszą być rozłączne — okno w obu zbiorach robiłoby z
 * metryk „holdout" metryki in-sample (POST /models/anfis/train, POST /models/baseline_v2/calibrate).
 */
export function assertDisjoint(trainWindows: number[], testWindows: number[]): void {
  const train = new Set(trainWindows);
  const overlap = [...new Set(testWindows)].filter((id) => train.has(id));
  if (overlap.length > 0) throw new HttpError(400, `Okna nie mogą być jednocześnie treningowe i testowe: ${overlap.join(", ")}`);
}
/** import:csv: poolAliases mapuje alias (nazwa kolumny `pool` w CSV) → pools.id — wszystkie
 * wartości muszą wskazywać na istniejące pule. */
export async function assertPoolsExist(db: Db, ids: number[]): Promise<void> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return;
  const idList = sql.join(
    uniqueIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = (await db.execute(sql`SELECT id FROM pools WHERE id IN (${idList})`)) as { id: number }[];
  const found = new Set(rows.map((r) => r.id));
  const missing = uniqueIds.filter((id) => !found.has(id));
  if (missing.length > 0) throw new HttpError(404, `Pule o id nie istnieją: ${missing.join(", ")}`);
}
/**
 * POST /models/anfis/train: `train_windows`/`test_windows` muszą wskazywać na
 * istniejące okna — ten sam wzorzec IN (...) co `assertPoolsExist` (`= ANY(...)` wiąże tablicę
 * JS jako jeden parametr rekordowy w drizzle, nie prawdziwą tablicę Postgresa).
 */
export async function assertWindowsExist(db: Db, ids: number[]): Promise<void> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return;
  const idList = sql.join(
    uniqueIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = (await db.execute(sql`SELECT id FROM windows WHERE id IN (${idList})`)) as { id: number }[];
  const found = new Set(rows.map((r) => r.id));
  const missing = uniqueIds.filter((id) => !found.has(id));
  if (missing.length > 0) throw new HttpError(404, `Okna o id nie istnieją: ${missing.join(", ")}`);
}

/**
 * Weryfikuje istnienie zasobów, na które wskazują parametry zadania.
 * train / calibrate:baseline_v2 nie mają referencji do zwalidowania tutaj — POST /models/anfis/train
 * i POST /models/baseline_v2/calibrate (nadawcy tych zadań) sprawdzają `trainWindows`/`testWindows` sami, przez `assertWindowsExist`, PRZED
 * wywołaniem `createJob` — patrz `routes/models.ts`.
 */
export async function assertRefsExist(db: Db, body: JobCreate): Promise<void> {
  if (body.type === "ingest:pool-window") {
    await assertPoolExists(db, body.params.poolId);
    await assertWindowExists(db, body.params.windowId);
  } else if (body.type === "analyze:pair-window" || body.type === "verify:pair-window") {
    await assertPairExists(db, body.params.pairId);
    await assertWindowExists(db, body.params.windowId);
  } else if (body.type === "import:csv") {
    await assertPoolsExist(db, Object.values(body.params.poolAliases));
  }
}

/**
 * SQLSTATE 23505 = unique_violation. drizzle-orm opakowuje błędy postgres-js w
 * `DrizzleQueryError`, którego własny `.code` jest `undefined` — prawdziwy `PostgresError`
 * (z `.code`) jest w `.cause`. Sprawdzamy oba miejsca, żeby nie zależeć od tego opakowania.
 */
function isUniqueViolation(err: unknown): boolean {
  const code = (o: unknown): unknown => (typeof o === "object" && o !== null && "code" in o ? (o as { code?: unknown }).code : undefined);
  return code(err) === "23505" || code((err as { cause?: unknown } | null)?.cause) === "23505";
}

/** Zadanie (type, params) już czekające lub w toku, jeśli istnieje. */
async function findActiveDuplicate(db: Db, body: JobCreate): Promise<unknown> {
  const rows = (await db.execute(sql`
    SELECT ${JOB_COLUMNS} FROM jobs
    WHERE type = ${body.type} AND params = ${JSON.stringify(body.params)}::jsonb
      AND status IN ('queued', 'running')
    LIMIT 1
  `)) as unknown[];
  return rows[0];
}

export type CreateJobResult = { status: 201; job: JobDto } | { status: 409; job: JobDto };

/**
 * Insertuje zadanie (type, params) `queued`, deduplikując przeciw zadania już
 * czekającego/w toku o identycznych (type, params) — reużywane przez `routes/jobs.ts`
 * (POST /jobs) i `routes/models.ts` (POST /models/anfis/train), żeby oba
 * miejsca miały IDENTYCZNĄ semantykę 409/wyścigu. Nie waliduje referencji (`assertRefsExist`)
 * — wywołujący robi to PRZED wywołaniem, bo dla `train` referencje (okna) są sprawdzane inaczej
 * niż dla pozostałych typów (patrz `assertRefsExist`).
 */
export async function createJob(db: Db, body: JobCreate): Promise<CreateJobResult> {
  // Dedup: identyczne (type, params) zadanie już czekające lub w toku → 409 ze wskazaniem go.
  // Równość jsonb w Postgresie jest strukturalna (znormalizowana), więc kolejność kluczy
  // w params nie ma znaczenia. Ten SELECT sam w sobie NIE wystarcza pod współbieżnością: dwa
  // równoległe żądania mogą oba przejść go, zanim którekolwiek zdąży wstawić wiersz (race
  // condition) — ostateczną gwarancję daje indeks unikalny częściowy `jobs_type_params_active_
  // unique` (migracja 0003, `WHERE status IN ('queued','running')`), patrz catch niżej.
  const dup = await findActiveDuplicate(db, body);
  if (dup) return { status: 409, job: JobDto.parse(dup) };

  try {
    const rows = (await db.execute(sql`
      INSERT INTO jobs (type, params, status, progress)
      VALUES (${body.type}, ${JSON.stringify(body.params)}::jsonb, 'queued', 0)
      RETURNING ${JOB_COLUMNS}
    `)) as unknown[];
    return { status: 201, job: JobDto.parse(rows[0]) };
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Przegraliśmy wyścig z równoległym żądaniem, które wstawiło identyczne (type, params)
      // między naszym SELECT-em a INSERT-em — zwracamy 409 z jego zadaniem, tak jak przy
      // sekwencyjnym duplikacie, zamiast 500. Jeden retry SELECT-a: sam
      // insert zwycięzcy wyścigu i widoczność jego wiersza dla naszego SELECT-a to dwie
      // osobne operacje — teoretycznie możliwe (choć bardzo mało prawdopodobne) urwanie na
      // przejściowym stanie, gdzie violation już zaszedł, a re-select jeszcze nic nie widzi.
      let existing = await findActiveDuplicate(db, body);
      existing ??= await findActiveDuplicate(db, body);
      if (existing) return { status: 409, job: JobDto.parse(existing) };
    }
    throw err;
  }
}
