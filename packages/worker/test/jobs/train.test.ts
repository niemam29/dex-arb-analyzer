// Testy części czystej zadania `train` — bez bazy.
import { describe, expect, it, vi } from "vitest";
import type * as Core from "@dex-arb/core";
import type * as Analysis from "@dex-arb/analysis";
import { buildDataset, computeGroupKeys, isVerifiedKnownOpportunity, type LabeledRow } from "@dex-arb/analysis";
import type { Provenance } from "@dex-arb/shared";

const PROVENANCE: Provenance = { gitSha: "0".repeat(40), nodeVersion: process.version, deps: { "@thi.ng/fuzzy": "0.0.0", "drizzle-orm": "0.0.0" }, rpcHost: null, windows: [], durationMs: 0, createdAt: new Date(0).toISOString() };

// `trainAnfis` opakowane w `vi.fn` wokół prawdziwej implementacji (`importOriginal`) — testy
// weryfikują, że `runTraining` przekazuje `opts.groups` do `trainAnfis`, przy zachowanym
// prawdziwym zachowaniu treningu (nie mockujemy wyniku, tylko podglądamy wywołanie).
vi.mock("@dex-arb/core", async (importOriginal) => {
  const actual = await importOriginal<typeof Core>();
  return { ...actual, trainAnfis: vi.fn(actual.trainAnfis) };
});
// `loadLabeledRows` zastąpione atrapą zwracającą `mockDb.rows`; `collectProvenance` atrapą zwracającą
// stałą proweniencję (nie dotyka `db`) — testy `makeTrain` nie mają prawdziwej bazy (`db = {}`).
const mockDb = vi.hoisted(() => ({
  rows: [] as unknown[],
  provenance: { gitSha: "0".repeat(40), nodeVersion: process.version, deps: { "@thi.ng/fuzzy": "0.0.0", "drizzle-orm": "0.0.0" }, rpcHost: null, windows: [], durationMs: 0, createdAt: new Date(0).toISOString() },
}));
vi.mock("@dex-arb/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof Analysis>();
  return { ...actual, loadLabeledRows: vi.fn(async () => mockDb.rows), collectProvenance: vi.fn(async () => mockDb.provenance) };
});
const { trainAnfis } = await import("@dex-arb/core");
const trainAnfisSpy = vi.mocked(trainAnfis);

const { computeDiagnostics, evaluate, hasKnownLabel, runTraining, splitTrainTestByTime } = await import("../../src/jobs/train.js");

const baseRow = (block: number, o: Partial<LabeledRow> = {}): LabeledRow => ({
  pairId: 1,
  windowId: 1,
  block,
  s: 0.1,
  g: 0.2,
  l: 30,
  m: 40,
  netProfitUsd: 0,
  grossProfitUsd: 0,
  optTradeUsd: 0,
  isOpportunity: false,
  verified: true,
  label: 0,
  estProfitUsd: null,
  consumerTxHash: null,
  blocksToConsumption: null,
  gasCostUsd: null,
  ...o,
});

/** Deterministyczny generator syntetycznych `LabeledRow[]` (LCG własny — bez zależności od mulberry32 z core, dla niezależności testu). */
function mk(n: number, seed: number): LabeledRow[] {
  let a = seed;
  const r = () => (a = (a * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  return Array.from({ length: n }, (_, i) => {
    const s = r() * 3;
    const g = r() * 2;
    const isOpp = s > 0.65;
    const label = (isOpp && s > 1 && g < 0.5 ? 1 : 0) as 0 | 1;
    return baseRow(i, {
      s,
      g,
      l: r() * 100,
      m: r() * 100,
      isOpportunity: isOpp,
      verified: true,
      label,
      estProfitUsd: isOpp ? (label === 1 ? 10 : -5) : null,
      consumerTxHash: isOpp ? `0xtx${i}` : null,
      blocksToConsumption: isOpp ? 1 : null,
      gasCostUsd: isOpp ? 2 : null,
    });
  });
}

describe("runTraining", () => {
  it("zwraca parametry i metryki train/test z AUC > 0.9, historię i diagnostykę", async () => {
    const { params, metrics } = await runTraining(
      mk(3000, 1),
      mk(1000, 2),
      { seed: 3, epochs: 40, lr: 0.01, trainWindows: [1], testWindows: [2], provenance: PROVENANCE },
    );
    expect(params.version).toBe(1);
    expect(metrics.population_block_states.train.auc).toBeGreaterThan(0.9);
    expect(metrics.population_block_states.test!.auc).toBeGreaterThan(0.9);
    expect(metrics.history.length).toBeGreaterThan(0);
    expect(metrics.diagnostics.groups).toBeGreaterThan(0);
    expect(metrics.dataset.nPos).toBeGreaterThan(0);
  }, 60_000);

  it("przekazuje klucze grupowe zbioru treningowego (opts.groups) do trainAnfis i zapisuje nGroupsTrain w metrykach", async () => {
    trainAnfisSpy.mockClear();
    const rows = mk(600, 5);
    const { metrics } = await runTraining(rows, [], { seed: 9, epochs: 3, lr: 0.01, trainWindows: [1], testWindows: [], provenance: PROVENANCE });

    expect(trainAnfisSpy).toHaveBeenCalledTimes(1);
    const [X, , callOpts] = trainAnfisSpy.mock.calls[0]!;
    expect(callOpts?.groups).toBeInstanceOf(Array);
    expect(callOpts!.groups).toHaveLength(X.length); // groups wyrównane 1:1 z X/y przekazanym do trainAnfis

    // nGroupsTrain w metrykach = liczba unikalnych grup dokładnie tego samego zbioru
    // (buildDataset(rowsTrain) — po podpróbkowaniu tła), które trafiło do trainAnfis.
    const expectedGroups = buildDataset(rows, { seed: 9 }).groups;
    expect(metrics.nGroupsTrain).toBe(new Set(expectedGroups).size);
    expect(metrics.nGroupsTrain).toBeGreaterThan(0);
  });

  it("ten sam seed -> identyczne AnfisParams i nGroupsTrain (determinizm zachowany z grupami)", async () => {
    const rows = mk(600, 5);
    const a = await runTraining(rows, [], { seed: 9, epochs: 5, lr: 0.01, trainWindows: [1], testWindows: [], provenance: PROVENANCE });
    const b = await runTraining(rows, [], { seed: 9, epochs: 5, lr: 0.01, trainWindows: [1], testWindows: [], provenance: PROVENANCE });
    expect(a.params).toEqual(b.params);
    expect(a.metrics.nGroupsTrain).toBe(b.metrics.nGroupsTrain);
  });

  it("classWeights.pos jest ograniczone do 50 przy skrajnym niezbalansowaniu (>=60:1)", async () => {
    const rows: LabeledRow[] = [
      baseRow(1, { isOpportunity: true, verified: true, label: 1, consumerTxHash: "0xpos" }), // 1 pozytyw
      ...Array.from({ length: 60 }, (_, i) => baseRow(100 + i, { isOpportunity: true, verified: true, label: 0, consumerTxHash: `0xneg${i}` })), // 60 negatywów zweryfikowanych
      ...Array.from({ length: 10 }, (_, i) => baseRow(1000 + i)), // tło (podpróbkowane do 10x1=10)
    ];
    const { metrics } = await runTraining(rows, [], { seed: 1, epochs: 2, lr: 0.01, trainWindows: [1], testWindows: [], provenance: PROVENANCE });
    expect(metrics.dataset.nPos).toBe(1);
    expect(metrics.dataset.nNeg + metrics.dataset.nBackground).toBeGreaterThanOrEqual(60);
    expect(metrics.classWeights.pos).toBe(50);
  });

  it("metrics zawiera obie populacje i provenance; population_verified liczy tylko zweryfikowane znane okazje", async () => {
    const rowsTrain = mk(3000, 1);
    const rowsTest = mk(1000, 2);
    const { metrics } = await runTraining(rowsTrain, rowsTest, { seed: 42, epochs: 3, lr: 0.01, trainWindows: [2], testWindows: [3], provenance: PROVENANCE });
    expect(metrics.provenance.gitSha).toBe("0".repeat(40));
    expect(metrics.population_verified.train.n).toBe(rowsTrain.filter(isVerifiedKnownOpportunity).length);
    expect(metrics.population_block_states.train.n).toBe(rowsTrain.filter(hasKnownLabel).length);
    expect(metrics.population_verified.train.n).toBeLessThan(metrics.population_block_states.train.n);
  });
});

describe("splitTrainTestByTime (grupowo świadomy)", () => {
  it("żadna grupa (ten sam consumerTxHash) nie jest rozdzielona między train i test", () => {
    const rows: LabeledRow[] = [
      // grupa tx A: 3 okazje tej samej transakcji na sąsiednich blokach, pozytyw
      baseRow(1, { isOpportunity: true, verified: true, label: 1, consumerTxHash: "0xA" }),
      baseRow(2, { isOpportunity: true, verified: true, label: 1, consumerTxHash: "0xA" }),
      baseRow(3, { isOpportunity: true, verified: true, label: 1, consumerTxHash: "0xA" }),
      // grupa tx B: 2 okazje, negatyw
      baseRow(50, { isOpportunity: true, verified: true, label: 0, consumerTxHash: "0xB" }),
      baseRow(51, { isOpportunity: true, verified: true, label: 0, consumerTxHash: "0xB" }),
      // pojedyncze okazje z różnymi tx (własne grupy)
      ...Array.from({ length: 20 }, (_, i) => baseRow(200 + i, { isOpportunity: true, verified: true, label: i % 2 === 0 ? 1 : 0, consumerTxHash: `0xC${i}` })),
      // tło (singletony)
      ...Array.from({ length: 100 }, (_, i) => baseRow(1000 + i)),
    ];

    const { train, test } = splitTrainTestByTime(rows, 0.2);

    const trainKeys = new Set(computeGroupKeys(train));
    const testKeys = new Set(computeGroupKeys(test));
    for (const k of trainKeys) expect(testKeys.has(k)).toBe(false);

    // grupa tx A (3 wiersze) i grupa tx B (2 wiersze) muszą być w CAŁOŚCI w jednej partycji.
    const blockOf = (rows: LabeledRow[]) => new Set(rows.map((r) => r.block));
    const trainBlocks = blockOf(train);
    const testBlocks = blockOf(test);
    const groupAInTrain = [1, 2, 3].every((b) => trainBlocks.has(b));
    const groupAInTest = [1, 2, 3].every((b) => testBlocks.has(b));
    expect(groupAInTrain || groupAInTest).toBe(true); // cała grupa w jednej partycji
    expect(groupAInTrain && groupAInTest).toBe(false); // nie rozdzielona

    const groupBInTrain = [50, 51].every((b) => trainBlocks.has(b));
    const groupBInTest = [50, 51].every((b) => testBlocks.has(b));
    expect(groupBInTrain || groupBInTest).toBe(true);
    expect(groupBInTrain && groupBInTest).toBe(false);
  });

  it("pomija niezweryfikowane okazje (nie trafiają ani do train, ani do test)", () => {
    const rows: LabeledRow[] = [
      baseRow(1, { isOpportunity: true, verified: false, consumerTxHash: null }),
      ...Array.from({ length: 20 }, (_, i) => baseRow(10 + i, { isOpportunity: true, verified: true, label: 1, consumerTxHash: `0x${i}` })),
      ...Array.from({ length: 20 }, (_, i) => baseRow(1000 + i)),
    ];
    const { train, test } = splitTrainTestByTime(rows, 0.2);
    expect([...train, ...test].some((r) => r.block === 1)).toBe(false);
  });

  it("~80/20 podział grup (nie wierszy) — proporcja przybliżona dla klasy tła", () => {
    const rows = Array.from({ length: 200 }, (_, i) => baseRow(i)); // 200 singletonów tła
    const { train, test } = splitTrainTestByTime(rows, 0.2);
    expect(train.length + test.length).toBe(200);
    expect(test.length).toBeCloseTo(40, -1); // ~20%
  });
});

describe("nieznana etykieta (route multi) — spójnie z buildDataset.nSkippedUnknown", () => {
  const unknown = (block: number) =>
    baseRow(block, { isOpportunity: true, verified: true, label: 0, consumerTxHash: `0xmulti${block}`, status: "consumed_atomic", route: "multi", realizedProfitUsd: null });
  const known = (block: number, label: 0 | 1) =>
    baseRow(block, { isOpportunity: true, verified: true, label, consumerTxHash: `0xtx${block}`, status: "consumed_atomic", route: "two_pool", realizedProfitUsd: label ? 10 : -1 });

  it("hasKnownLabel: tło i zweryfikowane z realizedProfitUsd -> true; niezweryfikowane i multi -> false", () => {
    expect(hasKnownLabel(baseRow(1))).toBe(true);
    expect(hasKnownLabel(known(2, 1))).toBe(true);
    expect(hasKnownLabel(baseRow(3, { isOpportunity: true, verified: true, label: 0, status: "decayed", realizedProfitUsd: null }))).toBe(true);
    expect(hasKnownLabel(baseRow(4, { isOpportunity: true, verified: false }))).toBe(false);
    expect(hasKnownLabel(unknown(5))).toBe(false);
  });

  it("evaluate: wiersze multi nie wchodzą do n/positives/confusion (tak samo jak buildDataset je pomija)", async () => {
    const rows = [...Array.from({ length: 30 }, (_, i) => baseRow(i)), known(100, 1), known(101, 0), unknown(200), unknown(201), unknown(202)];
    const ds = buildDataset(rows, { seed: 1 });
    expect(ds.meta.nSkippedUnknown).toBe(3);
    const { params } = await runTraining(rows, [], { seed: 1, epochs: 2, lr: 0.01, trainWindows: [1], testWindows: [], provenance: PROVENANCE });
    const ev = evaluate(params, rows);
    expect(ev.n).toBe(32); // 30 tła + 2 znane; 3 multi pominięte
    expect(ev.positives).toBe(1);
    expect(ev.confusion.tp + ev.confusion.fp + ev.confusion.fn + ev.confusion.tn).toBe(32);
  });

  it("splitTrainTestByTime: wiersze multi nie trafiają ani do train, ani do test", () => {
    const rows = [unknown(1), ...Array.from({ length: 20 }, (_, i) => known(10 + i, i % 2 === 0 ? 1 : 0)), ...Array.from({ length: 20 }, (_, i) => baseRow(1000 + i))];
    const { train, test } = splitTrainTestByTime(rows, 0.2);
    expect([...train, ...test].some((r) => r.block === 1)).toBe(false);
    expect(train.length + test.length).toBe(40);
  });
});

describe("computeDiagnostics", () => {
  it("liczy grupy, zero-gas consumers i wiersze z ujemnym est_profit_usd, a mimo to profitable", () => {
    const rows: LabeledRow[] = [
      baseRow(1, { isOpportunity: true, verified: true, label: 1, consumerTxHash: "0xA", gasCostUsd: 0, estProfitUsd: -5 }),
      baseRow(2, { isOpportunity: true, verified: true, label: 1, consumerTxHash: "0xA", gasCostUsd: 0, estProfitUsd: -5 }), // ta sama grupa, ten sam zero-gas consumer
      baseRow(3, { isOpportunity: true, verified: true, label: 0, consumerTxHash: "0xB", gasCostUsd: 3, estProfitUsd: 8 }),
      baseRow(4, { isOpportunity: true, verified: false, consumerTxHash: null }), // niezweryfikowana -> pomijana
      baseRow(5), // tło
    ];
    const d = computeDiagnostics(rows);
    expect(d.groups).toBe(2); // 0xA i 0xB (niezweryfikowana pominięta, tło nie liczone)
    expect(d.zeroGasConsumers).toBe(1); // tylko grupa 0xA
    expect(d.estProfitNegativeButProfitable).toBe(2); // oba wiersze grupy 0xA: label=1 i estProfitUsd<0
  });

  it("pomija zweryfikowane okazje o nieznanej etykiecie (trasa multi) — spójnie z evaluate/buildDataset", () => {
    const rows: LabeledRow[] = [
      baseRow(1, { isOpportunity: true, verified: true, label: 0, consumerTxHash: "0xA", status: "consumed_atomic", route: "two_pool", realizedProfitUsd: -1 }),
      baseRow(2, { isOpportunity: true, verified: true, label: 0, consumerTxHash: "0xM", status: "consumed_atomic", route: "multi", realizedProfitUsd: null, gasCostUsd: 0 }),
    ];
    const d = computeDiagnostics(rows);
    expect(d.groups).toBe(1);
    expect(d.zeroGasConsumers).toBe(0);
  });
});

describe("makeTrain — postęp i przerwanie w trakcie treningu", () => {
  mockDb.rows = mk(400, 21);
  // Przed treningiem job czyta tylko `loadLabeledRows` (atrapa wyżej); `db` jest pustym obiektem
  // — pierwszy dostęp do bazy PO treningu (zapis modelu) rzuca, co kończy test we właściwym miejscu.
  const dbLoadingRows = (): unknown => ({});
  const baseParams = { trainWindows: [1], testWindows: [], seed: 1, epochs: 30, lr: 0.01, excludeK0: false };

  it("ctx.progress jest wywoływane z rosnącymi wartościami W TRAKCIE treningu", async () => {
    const { makeTrain } = await import("../../src/jobs/train.js");
    const progress: number[] = [];
    const logs: string[] = [];
    const ac = new AbortController();
    const ctx = {
      jobId: 1,
      signal: ac.signal,
      log: async (m: string) => { logs.push(m); },
      progress: async (f: number) => { progress.push(f); },
    };
    const handler = makeTrain({ db: dbLoadingRows() as never });
    // Zapis modelu (db.insert) nie jest atrapowany — job ma się wywalić PO treningu; interesuje
    // nas tylko to, co zostało zgłoszone do tego momentu.
    await expect(handler(baseParams as never, ctx)).rejects.toThrow();

    const during = progress.filter((p) => p > 0.05 && p <= 0.6);
    expect(during.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < during.length; i++) expect(during[i]!).toBeGreaterThan(during[i - 1]!);
    expect(logs.some((l) => /^epoka 5:/.test(l))).toBe(true);
  });

  it("przerwanie sygnałem w trakcie treningu odrzuca handler błędem 'Przerwano'", async () => {
    const { makeTrain } = await import("../../src/jobs/train.js");
    const ac = new AbortController();
    let epochLogs = 0;
    const ctx = {
      jobId: 2,
      signal: ac.signal,
      log: async (m: string) => {
        if (/^epoka /.test(m) && ++epochLogs === 1) ac.abort(); // przerwij po pierwszym logu epoki
      },
      progress: async () => {},
    };
    const handler = makeTrain({ db: dbLoadingRows() as never });
    await expect(handler(baseParams as never, ctx)).rejects.toThrow("Przerwano");
    expect(epochLogs).toBe(1); // trening nie doszedł do kolejnego raportu epoki
  });
});
