// Testy czystej funkcji planMatrix: kolejność ingest→analyze(ref pierwsza)→
// verify per okno, okna chronologicznie, skipDone/force, filtry --pairs/--windows, dedup
// względem kolejki, szacunek czasu. Zero I/O — cały stan wejściowy podawany jawnie (CLI
// `packages/worker/scripts/matrix.ts` zbiera go z bazy i woła tę funkcję).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOW_BLOCKS,
  REFERENCE_PAIR_SYMBOL,
  estimateMinutes,
  jobKey,
  jobKeyFromRow,
  planMatrix,
  type JobType,
  type MatrixState,
  type VerifyCounts,
} from "./plan.js";

const pairs = [
  { id: 1, symbol: "WETH/USDC" },
  { id: 2, symbol: "WETH/USDT" },
  { id: 4, symbol: "WBTC/WETH" },
];
const pools = [
  { id: 10, pairId: 1, dexName: "uniswap-v2" },
  { id: 11, pairId: 1, dexName: "sushiswap" },
  { id: 20, pairId: 2, dexName: "uniswap-v2" },
  { id: 21, pairId: 2, dexName: "sushiswap" },
  { id: 40, pairId: 4, dexName: "uniswap-v2" },
  { id: 41, pairId: 4, dexName: "sushiswap" },
];
const windows = [
  { id: 1, name: "2021-05-krach", fromBlock: 12_430_000, toBlock: 12_510_000 },
  { id: 2, name: "2021-11-ath", fromBlock: 13_560_000, toBlock: 13_645_000 },
];

/** Domyślnie: dla każdej pary×okna istnieje 1 niezweryfikowana okazja (opportunities=1,
 * verified=0) — realistyczny punkt wyjścia "analyze już był, verify jeszcze nie", żeby testy
 * kolejności/skipDone nie musiały same dokładać liczników. Testy liczników nadpisują konkretne
 * klucze. Verify jest "done" (pomijane) TYLKO gdy para/okno jest już przeanalizowana
 * (`analyzeDone`) ORAZ `verified === opportunities` — sama równość liczników
 * bez bramki `analyzeDone` fałszywie oznaczałaby NIEZANALIZOWANE pary/okna (0 okazji, 0 weryfikacji)
 * jako "w pełni zweryfikowane" (0===0), więc nieodfiltrowany plan kończyłby się bez ŻADNEGO
 * verify:pair-window, mimo zaplanowanych analyze. */
function defaultVerifyCounts(): Map<string, VerifyCounts> {
  const m = new Map<string, VerifyCounts>();
  for (const p of pairs) for (const w of windows) m.set(`${p.id}:${w.id}`, { opportunities: 1, verified: 0 });
  return m;
}

function baseState(overrides: Partial<MatrixState> = {}): MatrixState {
  return {
    pairs,
    pools,
    windows,
    ingestDone: new Set(),
    analyzeDone: new Set(),
    verifyCounts: defaultVerifyCounts(),
    activeJobs: new Set(),
    ...overrides,
  };
}

const label = (j: { type: JobType; params: Record<string, number | boolean> }): string =>
  `${j.type}:${j.params.poolId ?? j.params.pairId}`;

describe("planMatrix", () => {
  it("per okno: wszystkie ingesty -> analyze WETH/USDC -> analyze reszty -> verify", () => {
    const plan = planMatrix(baseState());
    // 6 ingest + 3 analyze + 3 verify, dla 2 okien
    expect(plan).toHaveLength(2 * (6 + 3 + 3));

    const w1 = plan.filter((j) => j.params.windowId === 1).map(label);
    const idx = (s: string): number => w1.indexOf(s);
    for (const poolId of [10, 11, 20, 21, 40, 41]) {
      expect(idx(`ingest:pool-window:${poolId}`)).toBeLessThan(idx("analyze:pair-window:1"));
    }
    expect(idx("analyze:pair-window:1")).toBeLessThan(idx("analyze:pair-window:2"));
    expect(idx("analyze:pair-window:1")).toBeLessThan(idx("analyze:pair-window:4"));
    for (const pairId of [1, 2, 4]) {
      expect(idx(`analyze:pair-window:${pairId}`)).toBeLessThan(idx(`verify:pair-window:${pairId}`));
    }
  });

  it("okna w kolejności chronologicznej (wg from_block), wcześniejsze w całości przed późniejszym", () => {
    const plan = planMatrix(baseState());
    const lastW1 = plan.map((j) => j.params.windowId).lastIndexOf(1);
    const firstW2 = plan.map((j) => j.params.windowId).indexOf(2);
    expect(lastW1).toBeLessThan(firstW2);
  });

  it("okno z nierozstrzygniętymi blokami (from_block/to_block=null) idzie na koniec", () => {
    const unresolved = [...windows, { id: 3, name: "2022-05-luna", fromBlock: null, toBlock: null }];
    const plan = planMatrix(baseState({ windows: unresolved }));
    const windowIds = plan.map((j) => j.params.windowId);
    const firstUnresolved = windowIds.indexOf(3);
    const lastResolved = windowIds.lastIndexOf(2);
    expect(lastResolved).toBeLessThan(firstUnresolved);
  });

  it("skipDone pomija zadania ukończone (ingest 100% wg ingestDone), zachowując resztę", () => {
    const ingestDone = new Set([`10:1`]);
    const plan = planMatrix(baseState({ ingestDone }));
    expect(plan.find((j) => j.type === "ingest:pool-window" && j.params.poolId === 10 && j.params.windowId === 1)).toBeUndefined();
    expect(plan.filter((j) => j.params.windowId === 1)).toHaveLength(6 + 3 + 3 - 1);
  });

  it("skipDone: false (--no-skip-done) zleca WSZYSTKO od nowa, mimo ingest/analyze/verify już done", () => {
    const ingestDone = new Set([`10:1`]);
    const analyzeDone = new Set([`1:1`]);
    const verifyCounts = new Map(defaultVerifyCounts());
    verifyCounts.set("1:1", { opportunities: 5, verified: 5 });
    const plan = planMatrix(baseState({ ingestDone, analyzeDone, verifyCounts }), { skipDone: false });
    expect(plan.filter((j) => j.params.windowId === 1)).toHaveLength(6 + 3 + 3);
  });

  it("analyze pomijane gdy block_states istnieją, chyba że --force", () => {
    const analyzeDone = new Set([`1:1`]);
    const skipped = planMatrix(baseState({ analyzeDone }));
    expect(skipped.find((j) => j.type === "analyze:pair-window" && j.params.pairId === 1 && j.params.windowId === 1)).toBeUndefined();

    const forced = planMatrix(baseState({ analyzeDone }), { force: true });
    expect(forced.find((j) => j.type === "analyze:pair-window" && j.params.pairId === 1 && j.params.windowId === 1)).toBeDefined();
  });

  it("NIEZANALIZOWANA para/okno: ingest + analyze + verify planowane (verify leci zaraz po analyze, nawet zanim znane są okazje)", () => {
    // baseState(): analyzeDone puste -> żadna para/okno nie jest jeszcze przeanalizowana.
    const plan = planMatrix(baseState());
    const idx = (j: { type: JobType; params: Record<string, number | boolean> }): number => plan.indexOf(j);
    const analyze = plan.find((j) => j.type === "analyze:pair-window" && j.params.pairId === 4 && j.params.windowId === 2)!;
    const verify = plan.find((j) => j.type === "verify:pair-window" && j.params.pairId === 4 && j.params.windowId === 2)!;
    expect(analyze).toBeDefined();
    expect(verify).toBeDefined();
    expect(idx(analyze)).toBeLessThan(idx(verify));
  });

  it("PRZEANALIZOWANA i w pełni zweryfikowana (verified === opportunities > 0) -> verify pomijane", () => {
    const analyzeDone = new Set([`4:2`]);
    const verifyCounts = new Map(defaultVerifyCounts());
    verifyCounts.set("4:2", { opportunities: 5, verified: 5 });
    const plan = planMatrix(baseState({ analyzeDone, verifyCounts }));
    expect(plan.find((j) => j.type === "verify:pair-window" && j.params.pairId === 4 && j.params.windowId === 2)).toBeUndefined();
  });

  it("PRZEANALIZOWANA, ale częściowo zweryfikowana (verified < opportunities) -> verify PLANOWANE", () => {
    const analyzeDone = new Set([`4:2`]);
    const verifyCounts = new Map(defaultVerifyCounts());
    verifyCounts.set("4:2", { opportunities: 5, verified: 2 });
    const plan = planMatrix(baseState({ analyzeDone, verifyCounts }));
    expect(plan.find((j) => j.type === "verify:pair-window" && j.params.pairId === 4 && j.params.windowId === 2)).toBeDefined();
  });

  it("PRZEANALIZOWANA, ale 0 okazji (opportunities=0) -> verify pomijane (naprawdę nie ma czego weryfikować)", () => {
    const analyzeDone = new Set([`4:2`]);
    const verifyCounts = new Map(defaultVerifyCounts());
    verifyCounts.delete("4:2"); // brak wpisu = 0 okazji, 0 weryfikacji (tak zwraca LEFT JOIN w CLI)
    const plan = planMatrix(baseState({ analyzeDone, verifyCounts }));
    expect(plan.find((j) => j.type === "verify:pair-window" && j.params.pairId === 4 && j.params.windowId === 2)).toBeUndefined();
  });

  it("--force: analyze wymuszony mimo analyzeDone -> verify TEŻ nie jest 'done' (leci zaraz po reanalizie)", () => {
    const analyzeDone = new Set([`4:2`]);
    const verifyCounts = new Map(defaultVerifyCounts());
    verifyCounts.set("4:2", { opportunities: 5, verified: 5 }); // już w pełni zweryfikowane PRZED reanalizą
    const plan = planMatrix(baseState({ analyzeDone, verifyCounts }), { force: true });
    expect(plan.find((j) => j.type === "verify:pair-window" && j.params.pairId === 4 && j.params.windowId === 2)).toBeDefined();
  });

  it("--force: przekazywane DO PARAMETRÓW zaplanowanego verify:pair-window (nie tylko do bramki 'done')", () => {
    const plan = planMatrix(baseState(), { force: true });
    const verify = plan.find((j) => j.type === "verify:pair-window" && j.params.pairId === 4 && j.params.windowId === 2)!;
    expect(verify).toBeDefined();
    expect(verify.params.force).toBe(true);
  });

  it("bez --force: verify:pair-window NIE ma pola force w params (nie zmienia jobKey istniejących zadań w kolejce)", () => {
    const plan = planMatrix(baseState());
    const verify = plan.find((j) => j.type === "verify:pair-window" && j.params.pairId === 4 && j.params.windowId === 2)!;
    expect(verify).toBeDefined();
    expect(verify.params.force).toBeUndefined();
  });

  it("dedup: zadania już w kolejce (queued/running) są pomijane niezależnie od skipDone", () => {
    const activeJobs = new Set([jobKey("ingest:pool-window", { poolId: 10, windowId: 1 })]);
    const plan = planMatrix(baseState({ activeJobs }));
    expect(plan.find((j) => j.type === "ingest:pool-window" && j.params.poolId === 10 && j.params.windowId === 1)).toBeUndefined();
  });

  it("filtr --pairs/--windows: WETH/USDC dodawana do analizy jako referencja, ale nie do verify", () => {
    const plan = planMatrix(baseState(), { pairs: ["WBTC/WETH"], windows: ["2021-11-ath"] });
    expect(plan.every((j) => j.params.windowId === 2)).toBe(true);
    expect(plan.some((j) => j.type === "analyze:pair-window" && j.params.pairId === 1)).toBe(true);
    expect(plan.some((j) => j.type === "verify:pair-window" && j.params.pairId === 1)).toBe(false);
    // referencja jest pierwsza w analyze
    const analyzeOrder = plan.filter((j) => j.type === "analyze:pair-window").map((j) => j.params.pairId);
    expect(analyzeOrder[0]).toBe(1);
    // ingest tylko dla pul referencji (1) i żądanej pary (4), nie dla WETH/USDT (2)
    expect(plan.some((j) => j.type === "ingest:pool-window" && j.params.poolId === 20)).toBe(false);
  });

  it("filtr --pairs bez potrzeby referencji (WETH/USDC już w zbiorze) nie duplikuje jej", () => {
    const plan = planMatrix(baseState(), { pairs: ["WETH/USDC"], windows: ["2021-05-krach"] });
    expect(plan.filter((j) => j.type === "analyze:pair-window").map((j) => j.params.pairId)).toEqual([1]);
  });

  it("filtr --pairs WETH/USDT (quote=USDT, NIE WETH) -> referencja WETH/USDC NIE jest dodawana", () => {
    const plan = planMatrix(baseState(), { pairs: ["WETH/USDT"], windows: ["2021-05-krach"] });
    expect(plan.filter((j) => j.type === "analyze:pair-window").map((j) => j.params.pairId)).toEqual([2]);
    expect(plan.some((j) => j.params.pairId === 1)).toBe(false);
    // ingest tylko dla pul WETH/USDT (20,21), NIE dla referencji WETH/USDC (10,11)
    expect(plan.some((j) => j.type === "ingest:pool-window" && (j.params.poolId === 10 || j.params.poolId === 11))).toBe(false);
  });

  it("REFERENCE_PAIR_SYMBOL to WETH/USDC", () => {
    expect(REFERENCE_PAIR_SYMBOL).toBe("WETH/USDC");
  });
});

describe("estimateMinutes", () => {
  it("ingest skaluje liniowo z liczbą bloków (12,5 min / DEFAULT_WINDOW_BLOCKS, obserwowane 9–18 min)", () => {
    expect(estimateMinutes("ingest:pool-window", DEFAULT_WINDOW_BLOCKS)).toBeCloseTo(12.5, 5);
    expect(estimateMinutes("ingest:pool-window", DEFAULT_WINDOW_BLOCKS * 2)).toBeCloseTo(25, 5);
    expect(estimateMinutes("ingest:pool-window", null)).toBeCloseTo(12.5, 5);
  });
  it("DEFAULT_WINDOW_BLOCKS ≈ 90 000 (zgodne z realnymi oknami, nie 80 000)", () => {
    expect(DEFAULT_WINDOW_BLOCKS).toBe(90_000);
  });
  it("analyze ~10 s, verify ~2 min, niezależnie od liczby bloków", () => {
    expect(estimateMinutes("analyze:pair-window", 80_000)).toBeCloseTo(10 / 60, 5);
    expect(estimateMinutes("analyze:pair-window", null)).toBeCloseTo(10 / 60, 5);
    expect(estimateMinutes("verify:pair-window", 200_000)).toBe(2);
  });
});

describe("jobKey", () => {
  it("nie zależy od kolejności kluczy w params", () => {
    expect(jobKey("ingest:pool-window", { poolId: 1, windowId: 2 })).toBe(
      jobKey("ingest:pool-window", { windowId: 2, poolId: 1 }),
    );
  });

  it("ignoruje pole force (dedup niezależny od force)", () => {
    expect(jobKey("verify:pair-window", { pairId: 4, windowId: 2, force: true })).toBe(
      jobKey("verify:pair-window", { pairId: 4, windowId: 2 }),
    );
  });
});

describe("jobKeyFromRow (klucz activeJobs z wiersza tabeli jobs — CLI scripts/matrix.ts)", () => {
  it("wiersz verify:pair-window z force:true daje ten sam klucz co lookup planera bez force (regresja po 4db7a4d)", () => {
    const row = { type: "verify:pair-window", params: { pairId: 1, windowId: 2, force: true } as unknown };
    expect(jobKeyFromRow(row)).toBe(jobKey("verify:pair-window", { pairId: 1, windowId: 2 }));
  });

  it("planMatrix pomija verify, gdy w kolejce jest już aktywny verify tej pary/okna z force:true", () => {
    const activeJobs = new Set([
      jobKeyFromRow({ type: "verify:pair-window", params: { pairId: 1, windowId: 2, force: true } }),
    ]);
    const plan = planMatrix(baseState({ activeJobs }), { pairs: ["WETH/USDC"], windows: ["2021-11-ath"] });
    expect(plan.some((j) => j.type === "verify:pair-window" && j.params.pairId === 1 && j.params.windowId === 2)).toBe(false);
    // kontrola: bez aktywnego joba verify tej pary/okna JEST planowany
    const plain = planMatrix(baseState(), { pairs: ["WETH/USDC"], windows: ["2021-11-ath"] });
    expect(plain.some((j) => j.type === "verify:pair-window" && j.params.pairId === 1 && j.params.windowId === 2)).toBe(true);
  });

  it("nie zależy od kolejności pól JSON z bazy", () => {
    expect(jobKeyFromRow({ type: "ingest:pool-window", params: { windowId: 2, poolId: 10 } })).toBe(
      jobKey("ingest:pool-window", { poolId: 10, windowId: 2 }),
    );
  });
});
