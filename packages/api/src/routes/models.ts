// Trasy modeli oceny: POST /models/anfis/train, POST /models/baseline_v2/calibrate (baseline
// skalibrowany — zadanie `calibrate:baseline_v2`), GET /models/:id/evaluation.
// GET /models (listing) mieszka w routes/catalog.ts — dopisano tam
// tylko `training_metrics_summary` (patrz komentarz w tamtym pliku), nie duplikowano trasy tutaj.
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { CalibrateBaselineV2Request, TrainRequest, calibrateBaselineV2Params, trainParams, type JobCreate } from "@dex-arb/shared";
import { HttpError, parseOr400 } from "../plugins/zod.js";
import { assertDisjoint, assertWindowsExist, createJob } from "../jobs.js";
import { evaluateModelOnWindow, loadModelRow, loadWindowRef } from "../queries/evaluation.sql.js";

const IdParam = z.object({ id: z.coerce.number().int().positive() });
// `.strict()`: nieznany klucz (np. `?window_id=` zamiast `?window=`) -> 400 zamiast cichego
// zignorowania filtra i zwrócenia ewaluacji ze wszystkich okien. Spójnie z pozostałymi
// schematami query (jobs `ListQuery`, `SeriesQuery`, `OpportunityListQuery`).
const EvaluationQuery = z.object({ window: z.coerce.number().int().positive().optional() }).strict();

export const modelRoutes: FastifyPluginAsync = async (app) => {
  app.post("/models/anfis/train", async (req, reply) => {
    const body = parseOr400(TrainRequest, req.body);
    assertDisjoint(body.train_windows, body.test_windows);
    await assertWindowsExist(app.db, [...body.train_windows, ...body.test_windows]);

    // Kontrakt HTTP (TrainRequest, snake_case) -> kontrakt zadania kolejki (trainParams,
    // camelCase, packages/shared/src/jobs.ts) — pola nie podane w body dostają wartości
    // domyślne trainParams (seed=42, epochs=200, lr=0.01, excludeK0=false).
    const params = trainParams.parse({
      trainWindows: body.train_windows,
      testWindows: body.test_windows,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.seed !== undefined ? { seed: body.seed } : {}),
      ...(body.epochs !== undefined ? { epochs: body.epochs } : {}),
      ...(body.lr !== undefined ? { lr: body.lr } : {}),
      ...(body.exclude_k0 !== undefined ? { excludeK0: body.exclude_k0 } : {}),
    });
    const jobCreate: JobCreate = { type: "train", params };
    const result = await createJob(app.db, jobCreate);
    if (result.status === 409) {
      return reply.status(409).send({ error: "Takie zadanie już czeka lub jest w toku", job: result.job });
    }
    return reply.status(201).send(result.job);
  });

  // Lustrzane do POST /models/anfis/train: te same okna, 201/409 przez `createJob`. Bez
  // hiperparametrów — kalibracja to deterministyczna siatka (`calibrateBaselineV2Params`).
  app.post("/models/baseline_v2/calibrate", async (req, reply) => {
    const body = parseOr400(CalibrateBaselineV2Request, req.body);
    assertDisjoint(body.train_windows, body.test_windows);
    await assertWindowsExist(app.db, [...body.train_windows, ...body.test_windows]);
    const params = calibrateBaselineV2Params.parse({
      trainWindows: body.train_windows,
      testWindows: body.test_windows,
      ...(body.name !== undefined ? { name: body.name } : {}),
    });
    const jobCreate: JobCreate = { type: "calibrate:baseline_v2", params };
    const result = await createJob(app.db, jobCreate);
    if (result.status === 409) {
      return reply.status(409).send({ error: "Takie zadanie już czeka lub jest w toku", job: result.job });
    }
    return reply.status(201).send(result.job);
  });

  app.get("/models/:id/evaluation", async (req) => {
    const { id } = parseOr400(IdParam, req.params);
    const { window } = parseOr400(EvaluationQuery, req.query);
    const model = await loadModelRow(app.db, id);
    if (!model) throw new HttpError(404, `Nie znaleziono modelu o id=${id}`);
    let windowRef: { id: number; name: string } | null = null;
    if (window != null) {
      windowRef = (await loadWindowRef(app.db, window)) ?? null;
      if (!windowRef) throw new HttpError(404, `Nie znaleziono okna o id=${window}`);
    }
    return evaluateModelOnWindow(app.db, model, windowRef);
  });
};
