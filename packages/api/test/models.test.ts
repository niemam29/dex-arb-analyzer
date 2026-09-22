// Test integracyjny tras modeli oceny: POST /models/anfis/train,
// GET /models/:id/evaluation, oraz `training_metrics_summary` dopisane do GET /models (routes/catalog.ts).
// Model A = baseline (z seedCatalog) — ewaluacja ręcznie przeliczona (macierz pomyłek,
// precision/recall/f1). Model B = anfis (wstawiony tu ręcznie, z `metrics` jak zapisuje
// `packages/worker/src/jobs/train.ts`) — sprawdza class_weights/history/trained_on_window_ids,
// filtr `?window=`, i auc=null przy jednej klasie w próbce.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { EvaluationDto, JobDto, ModelList } from "@dex-arb/shared";
import { buildApp } from "../src/app.js";
import { HAS_DB, testDb, type SeedIds, type TestDb } from "./helpers/db.js";

let t: TestDb;
let app: ReturnType<typeof buildApp>;
let ids: SeedIds;
let window2Id: number;
let anfisModelId: number;
let baselineV2ModelId: number;

const baselineV2Params = { gasUnits: 150000, arbGasRef: 220000, gasPriceFactor: 0.5, threshold: 0.42, weightOptTrade: 0, scale: 12.5, optTradeQuantiles: [0, 1, 2] };

describe.skipIf(!HAS_DB)("api: models (DATABASE_URL_TEST)", () => {
  beforeAll(async () => {
    t = await testDb();
    app = buildApp({ db: t.db });
    await t.reset();
    ids = await t.seedCatalog();

    const [w2] = await t.db.execute<{ id: number }>(sql`
      INSERT INTO windows (name, from_ts, to_ts, from_block, to_block)
      VALUES ('test-okno-2', '2021-05-15T00:00:00Z', '2021-05-15T01:00:00Z', 2000, 2999)
      RETURNING id
    `);
    window2Id = w2!.id;

    const anfisMetrics = {
      train: { auc: 0.81, f1: 0.6 },
      test: { auc: 0.77, f1: 0.55 },
      history: [
        { epoch: 1, trainLoss: 0.5, valLoss: 0.6 },
        { epoch: 2, trainLoss: 0.4, valLoss: 0.5 },
      ],
      classWeights: { pos: 3, neg: 1 },
      trainWindows: [ids.windowId],
    };
    const [m] = await t.db.execute<{ id: number }>(sql`
      INSERT INTO scoring_models (name, kind, version, params, trained_on_window_ids, metrics)
      VALUES ('anfis-test', 'anfis', 1, '{}'::jsonb, ARRAY[${ids.windowId}]::integer[], ${JSON.stringify(anfisMetrics)}::jsonb)
      RETURNING id
    `);
    anfisModelId = m!.id;

    // Model C = baseline_v2 (baseline skalibrowany): metrics w kształcie zapisywanym przez
    // `packages/worker/src/jobs/calibrateBaselineV2.ts` (klucze calibration/holdout, NIE train/test).
    const bv2Metrics = { population: "verified_opportunities", calibration: { n: 3, positives: 2, auc: 1, f1: 1 }, holdout: null, grid: [], trainWindows: [ids.windowId], testWindows: [] };
    const [m2] = await t.db.execute<{ id: number }>(sql`
      INSERT INTO scoring_models (name, kind, version, params, trained_on_window_ids, metrics)
      VALUES ('baseline_v2', 'baseline_v2', 1, ${JSON.stringify(baselineV2Params)}::jsonb, ARRAY[${ids.windowId}]::integer[], ${JSON.stringify(bv2Metrics)}::jsonb)
      RETURNING id
    `);
    baselineV2ModelId = m2!.id;

    // Okno 1 (ids.windowId): 8 okazji zweryfikowanych. Blok 106 CELOWO nie ma wyniku modelu A
    // (baseline) — sprawdza wykluczanie wierszy bez score z `n`.
    const win1Blocks: { block: number; profitable: boolean }[] = [
      { block: 100, profitable: true },
      { block: 101, profitable: true },
      { block: 102, profitable: true },
      { block: 103, profitable: false },
      { block: 104, profitable: false },
      { block: 105, profitable: false },
      { block: 106, profitable: true },
      { block: 107, profitable: false },
    ];
    // `consumer_tx_hash` wymagany (CHECK `..._consumer_iff_consumed_check`, migracja 0007) dokładnie
    // wtedy, gdy status IN ('consumed_atomic', 'consumed_partial') — deterministyczny hash per blok.
    const txHash = (block: number) => `0x${String(block).padStart(64, "0")}`;
    for (const { block, profitable } of win1Blocks) {
      const [o] = await t.db.execute<{ id: number }>(sql`
        INSERT INTO opportunities (pair_id, window_id, block, spread_pct, direction, est_profit_usd)
        VALUES (${ids.pairId}, ${ids.windowId}, ${block}, 1.0, 'a_to_b', 10)
        RETURNING id
      `);
      await t.db.execute(sql`
        INSERT INTO opportunity_verifications (opportunity_id, status, route, consumer_tx_hash, profitable_consumed, verified_at)
        VALUES (${o!.id}, ${profitable ? "consumed_atomic" : "decayed"}, ${profitable ? "two_pool" : null}, ${profitable ? txHash(block) : null}, ${profitable}, now())
      `);
    }

    // Okno 1, blok 108: consumed_atomic przez agregator (route='multi', zysk nieznany,
    // profitable_consumed=false). Ma score w OBU modelach (A: 99, B: 99 — "predicted positive"),
    // a mimo to NIE MOŻE trafić do populacji ewaluacji (ani do n, ani do n_positive, ani jako fp).
    {
      const [o] = await t.db.execute<{ id: number }>(sql`
        INSERT INTO opportunities (pair_id, window_id, block, spread_pct, direction, est_profit_usd)
        VALUES (${ids.pairId}, ${ids.windowId}, 108, 1.0, 'a_to_b', 10)
        RETURNING id
      `);
      await t.db.execute(sql`
        INSERT INTO opportunity_verifications (opportunity_id, status, route, consumer_tx_hash, realized_profit_usd, profitable_consumed, verified_at)
        VALUES (${o!.id}, 'consumed_atomic', 'multi', ${txHash(108)}, NULL, false, now())
      `);
      for (const modelId of [ids.modelId, anfisModelId]) {
        await t.db.execute(sql`
          INSERT INTO model_scores (model_id, pair_id, block, score, label)
          VALUES (${modelId}, ${ids.pairId}, 108, 99, 'atrakcyjna')
        `);
      }
    }

    // Okno 2 (window2Id): 2 okazje, obie profitable=true (jedna klasa) — test auc=null po filtrze.
    for (const block of [200, 201]) {
      const [o] = await t.db.execute<{ id: number }>(sql`
        INSERT INTO opportunities (pair_id, window_id, block, spread_pct, direction, est_profit_usd)
        VALUES (${ids.pairId}, ${window2Id}, ${block}, 1.0, 'a_to_b', 10)
        RETURNING id
      `);
      await t.db.execute(sql`
        INSERT INTO opportunity_verifications (opportunity_id, status, route, consumer_tx_hash, profitable_consumed, verified_at)
        VALUES (${o!.id}, 'consumed_atomic', 'two_pool', ${txHash(block)}, true, now())
      `);
    }

    // Model A (baseline): score na blokach 100-105 i 107 (NIE 106).
    const modelAScores: [number, number][] = [
      [100, 80],
      [101, 90],
      [102, 30],
      [103, 70],
      [104, 20],
      [105, 10],
      [107, 60],
    ];
    for (const [block, score] of modelAScores) {
      await t.db.execute(sql`
        INSERT INTO model_scores (model_id, pair_id, block, score, label)
        VALUES (${ids.modelId}, ${ids.pairId}, ${block}, ${score}, 'ryzykowna')
      `);
    }

    // Model B (anfis): score na blokach 100-105 okna 1 (bez 106/107) i na obu blokach okna 2.
    const modelBScores: [number, number][] = [
      [100, 85],
      [101, 75],
      [102, 40],
      [103, 65],
      [104, 15],
      [105, 5],
      [200, 95],
      [201, 90],
    ];
    for (const [block, score] of modelBScores) {
      await t.db.execute(sql`
        INSERT INTO model_scores (model_id, pair_id, block, score, label)
        VALUES (${anfisModelId}, ${ids.pairId}, ${block}, ${score}, 'wykonalna')
      `);
    }
  });

  afterAll(async () => {
    await app.close();
    await t.close();
  });

  describe("POST /models/anfis/train", () => {
    it("tworzy zadanie train (201 + JobDto), mapuje TrainRequest -> trainParams camelCase z domyślnymi", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/models/anfis/train",
        payload: { train_windows: [ids.windowId], test_windows: [window2Id], seed: 7, exclude_k0: true },
      });
      expect(res.statusCode).toBe(201);
      const job = JobDto.parse(res.json());
      expect(job.type).toBe("train");
      expect(job.status).toBe("queued");
      expect(job.params).toMatchObject({
        trainWindows: [ids.windowId],
        testWindows: [window2Id],
        seed: 7,
        epochs: 200,
        lr: 0.01,
        excludeK0: true,
      });

      const getRes = await app.inject({ method: "GET", url: `/jobs/${job.id}` });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().params).toMatchObject({ trainWindows: [ids.windowId], testWindows: [window2Id] });
    });

    it("okno jednocześnie w train_windows i test_windows -> 400 (train i calibrate)", async () => {
      const payload = { train_windows: [ids.windowId, window2Id], test_windows: [window2Id] };
      const a = await app.inject({ method: "POST", url: "/models/anfis/train", payload });
      expect(a.statusCode).toBe(400);
      expect(a.json()).toMatchObject({ error: expect.stringContaining(String(window2Id)) });
      const b = await app.inject({ method: "POST", url: "/models/baseline_v2/calibrate", payload });
      expect(b.statusCode).toBe(400);
    });

    it("train_windows pusta tablica -> 400", async () => {
      const res = await app.inject({ method: "POST", url: "/models/anfis/train", payload: { train_windows: [] } });
      expect(res.statusCode).toBe(400);
    });

    it("nieistniejące okno w train_windows -> 404", async () => {
      const res = await app.inject({ method: "POST", url: "/models/anfis/train", payload: { train_windows: [999999] } });
      expect(res.statusCode).toBe(404);
    });

    it("nieistniejące okno w test_windows -> 404", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/models/anfis/train",
        payload: { train_windows: [ids.windowId], test_windows: [999999] },
      });
      expect(res.statusCode).toBe(404);
    });

    it("identyczne (type, params) zadanie już w kolejce -> 409", async () => {
      const payload = { train_windows: [ids.windowId], test_windows: [] };
      const first = await app.inject({ method: "POST", url: "/models/anfis/train", payload });
      expect(first.statusCode).toBe(201);
      const second = await app.inject({ method: "POST", url: "/models/anfis/train", payload });
      expect(second.statusCode).toBe(409);
      expect(second.json().job.id).toBe(first.json().id);
    });
  });

  describe("POST /models/baseline_v2/calibrate", () => {
    it("tworzy zadanie calibrate:baseline_v2 (201 + JobDto), mapuje snake_case -> camelCase", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/models/baseline_v2/calibrate",
        payload: { train_windows: [ids.windowId], test_windows: [window2Id], name: "bv2-test" },
      });
      expect(res.statusCode).toBe(201);
      const job = JobDto.parse(res.json());
      expect(job.type).toBe("calibrate:baseline_v2");
      expect(job.status).toBe("queued");
      expect(job.params).toEqual({ trainWindows: [ids.windowId], testWindows: [window2Id], name: "bv2-test" });
    });

    it("train_windows pusta -> 400; nieistniejące okno -> 404", async () => {
      expect((await app.inject({ method: "POST", url: "/models/baseline_v2/calibrate", payload: { train_windows: [] } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/models/baseline_v2/calibrate", payload: { train_windows: [999999] } })).statusCode).toBe(404);
      expect(
        (await app.inject({ method: "POST", url: "/models/baseline_v2/calibrate", payload: { train_windows: [ids.windowId], test_windows: [999999] } })).statusCode,
      ).toBe(404);
    });

    it("identyczne zadanie już w kolejce -> 409 ze wskazaniem istniejącego", async () => {
      const payload = { train_windows: [ids.windowId] };
      const first = await app.inject({ method: "POST", url: "/models/baseline_v2/calibrate", payload });
      expect(first.statusCode).toBe(201);
      const second = await app.inject({ method: "POST", url: "/models/baseline_v2/calibrate", payload });
      expect(second.statusCode).toBe(409);
      expect(second.json().job.id).toBe(first.json().id);
    });
  });

  describe("GET /models/:id/evaluation", () => {
    it("nieznany model -> 404", async () => {
      const res = await app.inject({ method: "GET", url: "/models/999999/evaluation" });
      expect(res.statusCode).toBe(404);
    });

    it("nieznane okno w ?window= -> 404", async () => {
      const res = await app.inject({ method: "GET", url: `/models/${ids.modelId}/evaluation?window=999999` });
      expect(res.statusCode).toBe(404);
    });

    it("nieznany klucz query (?window_id= zamiast ?window=) -> 400 (schemat .strict())", async () => {
      const res = await app.inject({ method: "GET", url: `/models/${ids.modelId}/evaluation?window_id=${ids.windowId}` });
      expect(res.statusCode).toBe(400);
    });

    it("model A (baseline), okno 1: macierz pomyłek/precision/recall/f1 ręcznie przeliczone; blok bez score wykluczony z n", async () => {
      const res = await app.inject({ method: "GET", url: `/models/${ids.modelId}/evaluation?window=${ids.windowId}` });
      expect(res.statusCode).toBe(200);
      const e = EvaluationDto.parse(res.json());

      expect(e.model).toMatchObject({ id: ids.modelId, kind: "baseline" });
      expect(e.window).toMatchObject({ id: ids.windowId, name: "test-okno" });
      // 8 okazji zweryfikowanych w oknie 1, blok 106 bez score -> n=7.
      expect(e.n).toBe(7);
      expect(e.n_positive).toBe(3); // bloki 100,101,102 (profitable=true, 106 wykluczony)
      expect(e.confusion).toEqual({ tp: 2, fp: 2, tn: 2, fn: 1 });
      expect(e.confusion.tp + e.confusion.fp + e.confusion.fn + e.confusion.tn).toBe(e.n);
      expect(e.precision).toBeCloseTo(0.5, 9); // 2/(2+2)
      expect(e.recall).toBeCloseTo(2 / 3, 9); // 2/(2+1)
      expect(e.f1).toBeCloseTo((2 * 0.5 * (2 / 3)) / (0.5 + 2 / 3), 9);
      expect(e.auc).not.toBeNull();
      expect(e.roc.fpr.length).toBe(e.roc.tpr.length);
      expect(e.roc.fpr.length).toBeGreaterThan(2);
      expect(e.histogram.edges.length).toBe(e.histogram.positive.length + 1);
      expect(e.histogram.edges.length).toBe(e.histogram.negative.length + 1);
      // baseline: bez pól specyficznych dla anfis
      expect(e.class_weights).toBeUndefined();
      expect(e.history).toBeUndefined();
      expect(e.trained_on_window_ids).toBeUndefined();
    });

    it("model B (anfis) bez ?window=: wszystkie okna zweryfikowane, window=null, pola anfis obecne", async () => {
      const res = await app.inject({ method: "GET", url: `/models/${anfisModelId}/evaluation` });
      expect(res.statusCode).toBe(200);
      const e = EvaluationDto.parse(res.json());

      expect(e.model).toMatchObject({ id: anfisModelId, kind: "anfis" });
      expect(e.window).toBeNull();
      // okno1 (6 ocenionych bloków) + okno2 (2 ocenione bloki) = 8.
      expect(e.n).toBe(8);
      expect(e.n_positive).toBe(5); // okno1: 100,101,102; okno2: 200,201
      expect(e.confusion).toEqual({ tp: 4, fp: 1, tn: 2, fn: 1 });

      expect(e.class_weights).toEqual({ pos: 3, neg: 1 });
      expect(e.history).toEqual([
        { epoch: 1, train_loss: 0.5, val_loss: 0.6 },
        { epoch: 2, train_loss: 0.4, val_loss: 0.5 },
      ]);
      expect(e.trained_on_window_ids).toEqual([ids.windowId]);
    });

    it("model B (anfis) z ?window= okno1: filtruje do 6 bloków, macierz przeliczona ręcznie", async () => {
      const res = await app.inject({ method: "GET", url: `/models/${anfisModelId}/evaluation?window=${ids.windowId}` });
      const e = EvaluationDto.parse(res.json());
      expect(e.window).toMatchObject({ id: ids.windowId });
      expect(e.n).toBe(6);
      expect(e.n_positive).toBe(3);
      expect(e.confusion).toEqual({ tp: 2, fp: 1, tn: 2, fn: 1 });
    });

    it("route='multi' (zysk nieznany) wykluczone z populacji etykiet: nie liczone w n / n_positive / fp", async () => {
      // Blok 108 ma score=99 (>= próg) w obu modelach; gdyby wszedł do populacji jako
      // profitable=false, podniósłby n o 1 i fp o 1 (baseline: n=8, fp=3; anfis: n=9, fp=2).
      const [row] = await t.db.execute<{ c: number }>(sql`
        SELECT count(*)::int AS c FROM opportunity_verifications ov
        JOIN opportunities o ON o.id = ov.opportunity_id
        WHERE ov.route = 'multi' AND o.block = 108
      `);
      expect(row!.c).toBe(1);

      const a = EvaluationDto.parse((await app.inject({ method: "GET", url: `/models/${ids.modelId}/evaluation?window=${ids.windowId}` })).json());
      expect(a.n).toBe(7);
      expect(a.n_positive).toBe(3);
      expect(a.confusion).toEqual({ tp: 2, fp: 2, tn: 2, fn: 1 });

      const b = EvaluationDto.parse((await app.inject({ method: "GET", url: `/models/${anfisModelId}/evaluation` })).json());
      expect(b.n).toBe(8);
      expect(b.n_positive).toBe(5);
      expect(b.confusion).toEqual({ tp: 4, fp: 1, tn: 2, fn: 1 });
    });

    it("model B (anfis) z ?window= okno2: jedna klasa (wszystko profitable) -> auc: null", async () => {
      const res = await app.inject({ method: "GET", url: `/models/${anfisModelId}/evaluation?window=${window2Id}` });
      const e = EvaluationDto.parse(res.json());
      expect(e.n).toBe(2);
      expect(e.n_positive).toBe(2);
      expect(e.auc).toBeNull();
      expect(e.confusion).toEqual({ tp: 2, fp: 0, tn: 0, fn: 0 });
    });

    it("auc_ci95 obejmuje auc, pr_auc w (0,1]; threshold_train_opt tylko dla modelu z trained_on_window_ids", async () => {
      const a = EvaluationDto.parse((await app.inject({ method: "GET", url: `/models/${ids.modelId}/evaluation?window=${ids.windowId}` })).json());
      expect(a.auc_ci95).not.toBeNull();
      expect(a.auc_ci95![0]).toBeLessThanOrEqual(a.auc!);
      expect(a.auc_ci95![1]).toBeGreaterThanOrEqual(a.auc!);
      expect(a.pr_auc).toBeGreaterThan(0);
      expect(a.threshold_train_opt).toBeUndefined(); // baseline z seedCatalog: trained_on_window_ids NULL

      const b = EvaluationDto.parse((await app.inject({ method: "GET", url: `/models/${anfisModelId}/evaluation` })).json());
      // anfis-test trenowany na oknie 1 (6 ocenionych bloków, 3 pozytywy: 85/75/40 vs 65/15/5) ->
      // cięcia: 85 F1=.5, 75 .8, 65 .667, 40 .857 (tp3 fp1), 15 .75, 5 .667 -> próg (40+15)/2
      expect(b.threshold_train_opt).toBeCloseTo(27.5, 9);
    });

    it("okno z jedną klasą: auc_ci95 = null, pr_auc = 1 (same pozytywy)", async () => {
      const e = EvaluationDto.parse((await app.inject({ method: "GET", url: `/models/${anfisModelId}/evaluation?window=${window2Id}` })).json());
      expect(e.auc_ci95).toBeNull();
      expect(e.pr_auc).toBe(1);
    });
  });

  describe("GET /models/:id/evaluation — baseline_v2", () => {
    it("kind baseline_v2 przechodzi przez EvaluationDto, bez pól anfis; n = okazje z model_scores", async () => {
      for (const [block, score] of [
        [100, 70],
        [103, 30],
      ] as [number, number][]) {
        await t.db.execute(sql`INSERT INTO model_scores (model_id, pair_id, block, score, label) VALUES (${baselineV2ModelId}, ${ids.pairId}, ${block}, ${score}, 'ryzykowna')`);
      }
      const res = await app.inject({ method: "GET", url: `/models/${baselineV2ModelId}/evaluation?window=${ids.windowId}` });
      expect(res.statusCode).toBe(200);
      const e = EvaluationDto.parse(res.json());
      expect(e.model).toMatchObject({ id: baselineV2ModelId, kind: "baseline_v2" });
      expect(e.n).toBe(2);
      expect(e.confusion).toEqual({ tp: 1, fp: 0, tn: 1, fn: 0 });
      expect(e.class_weights).toBeUndefined();
      expect(e.history).toBeUndefined();
    });
  });

  describe("GET /models — training_metrics_summary", () => {
    it("dopisuje training_metrics_summary (auc/f1 z metrics.test, population='block_states') dla modelu anfis; brak dla baseline bez metrics", async () => {
      const res = await app.inject({ method: "GET", url: "/models" });
      expect(res.statusCode).toBe(200);
      const models = ModelList.parse(res.json());

      const baseline = models.find((m) => m.id === ids.modelId)!;
      expect(baseline.training_metrics_summary).toBeUndefined();

      const anfis = models.find((m) => m.id === anfisModelId)!;
      expect(anfis.training_metrics_summary).toEqual({ population: "block_states", auc: 0.77, f1: 0.55 });
      // stara nazwa pola nie może już występować w odpowiedzi
      expect((res.json() as Record<string, unknown>[]).some((m) => "metrics_summary" in m)).toBe(false);

      // baseline_v2: `params` dołączone (tylko dla tego kind). training_metrics_summary jest tu
      // undefined, bo fixture `bv2Metrics` wyżej celowo pomija `population_verified`/
      // `population_block_states` (metricsSummaryFrom ich nie znajduje w takim kształcie) —
      // prawdziwy zapis `calibrateBaselineV2.ts` dopisuje obie populacje (ADR 0008), więc
      // realny model baseline_v2 dostaje training_metrics_summary tak samo jak anfis.
      const bv2 = models.find((m) => m.id === baselineV2ModelId)!;
      expect(bv2.kind).toBe("baseline_v2");
      expect(bv2.params).toEqual(baselineV2Params);
      expect(bv2.training_metrics_summary).toBeUndefined();
      expect(baseline.params).toBeUndefined();
      expect(anfis.params).toBeUndefined();
    });
  });
});
