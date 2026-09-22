// Baseline v2 (skalibrowany): ocena, mapowanie score, kalibracja siatką na danych syntetycznych.
import { describe, expect, it } from "vitest";
import {
  ARB_GAS,
  BaselineV2Model,
  bestF1Threshold,
  calibrateBaselineV2,
  deciles,
  gasCostV1FromRow,
  netProfitV2Usd,
  quantileRank,
  robustScale,
  rocAuc,
  scoreFromStatistic,
  type BaselineV2CalibrationRow,
  type BaselineV2Params,
} from "../src/index.js";

const params: BaselineV2Params = {
  gasUnits: 150_000,
  arbGasRef: ARB_GAS,
  gasPriceFactor: 0.5,
  threshold: 0.5,
  weightOptTrade: 0,
  scale: 10,
  optTradeQuantiles: deciles([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]),
};

describe("gasCostV1FromRow / netProfitV2Usd", () => {
  it("koszt gazu v1 = brutto − netto v1; 0 dla bloku bez arbitrażu", () => {
    expect(gasCostV1FromRow(50, 20)).toBe(30);
    expect(gasCostV1FromRow(0, 0)).toBe(0);
    expect(gasCostV1FromRow(0, -30)).toBe(30); // kierunek jest, ale brutto 0
    expect(gasCostV1FromRow(10, 20)).toBe(0); // niemożliwe przy poprawnych danych — obcięte
  });
  it("net2 skaluje koszt gazu v1 przez gasUnits/arbGasRef i gasPriceFactor", () => {
    const i = { grossProfitUsd: 100, gasCostV1Usd: 44, optTradeUsd: 0 };
    expect(netProfitV2Usd(i, { gasUnits: ARB_GAS, arbGasRef: ARB_GAS, gasPriceFactor: 1 })).toBeCloseTo(56, 9);
    expect(netProfitV2Usd(i, { gasUnits: ARB_GAS / 2, arbGasRef: ARB_GAS, gasPriceFactor: 1 })).toBeCloseTo(78, 9);
    expect(netProfitV2Usd(i, { gasUnits: ARB_GAS, arbGasRef: ARB_GAS, gasPriceFactor: 0 })).toBe(100);
    // arbGasRef z parametrów, nie ze stałej: ten sam gasUnits przy innym odniesieniu daje inny koszt
    expect(netProfitV2Usd(i, { gasUnits: 110_000, arbGasRef: 110_000, gasPriceFactor: 1 })).toBeCloseTo(56, 9);
  });
});

describe("quantileRank / deciles / robustScale", () => {
  it("ranga interpoluje liniowo między decylami, obcina na krańcach i toleruje remisy kwantyli", () => {
    const q = deciles([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    expect(q).toHaveLength(11);
    expect(quantileRank(q, -5)).toBe(0);
    expect(quantileRank(q, 5000)).toBe(1);
    expect(quantileRank(q, 500)).toBeCloseTo(0.5, 9);
    expect(quantileRank(q, 250)).toBeCloseTo(0.25, 9);
    const tied = [0, 0, 0, 0, 0, 0, 10, 20, 30, 40, 50];
    expect(quantileRank(tied, 0)).toBe(0);
    expect(quantileRank(tied, 5)).toBeCloseTo(0.55, 9);
    expect(Number.isNaN(quantileRank(tied, 1))).toBe(false);
  });
  it("robustScale: 1,4826·MAD; SD gdy MAD=0; 1 gdy wszystko stałe", () => {
    expect(robustScale([1, 2, 3, 4, 5])).toBeCloseTo(1.4826, 6);
    expect(robustScale([0, 0, 0, 0, 10])).toBeGreaterThan(0);
    expect(robustScale([7, 7, 7])).toBe(1);
    expect(robustScale([])).toBe(1);
  });
});

describe("scoreFromStatistic / BaselineV2Model", () => {
  it("odcinkowo-liniowe: v=threshold ↦ 50, monotoniczne, w [0,100]", () => {
    expect(scoreFromStatistic(0.3, 0.3)).toBe(50);
    expect(scoreFromStatistic(0, 0.3)).toBe(0);
    expect(scoreFromStatistic(1, 0.3)).toBe(100);
    expect(scoreFromStatistic(0.15, 0.3)).toBeCloseTo(25, 9);
    expect(scoreFromStatistic(0.65, 0.3)).toBeCloseTo(75, 9);
  });
  it("score ≥ 50 ⇔ net2 ≥ 0 przy threshold 0,5 i wyłączonej randze; etykieta z labelForScore", () => {
    const m = new BaselineV2Model(params);
    const pos = m.scoreInputs({ grossProfitUsd: 100, gasCostV1Usd: 44, optTradeUsd: 500 });
    const zero = m.scoreInputs({ grossProfitUsd: 15, gasCostV1Usd: 44, optTradeUsd: 500 }); // net2 = 15 − 0.5·(150/220)·44 = 0
    const neg = m.scoreInputs({ grossProfitUsd: 0, gasCostV1Usd: 44, optTradeUsd: 500 });
    expect(pos.score).toBeGreaterThan(50);
    expect(zero.score).toBeCloseTo(50, 6);
    expect(neg.score).toBeLessThan(50);
    expect(pos.label).not.toBe("niewykonalna");
    expect(neg.label).toBe("niewykonalna");
    expect(neg.score).toBe(0); // gross ≤ 0 (brak arbitrażu) -> 0, nie sigmoid(0)=0,5
    expect(m.scoreInputs({ grossProfitUsd: 0, gasCostV1Usd: 0, optTradeUsd: 0 }).score).toBe(0);
    expect(m.kind).toBe("baseline_v2");
  });
  it("monotoniczność: większe brutto -> większy score; większy optTrade przy wadze > 0 -> większy score", () => {
    const m = new BaselineV2Model(params);
    const a = m.scoreInputs({ grossProfitUsd: 10, gasCostV1Usd: 5, optTradeUsd: 100 }).score;
    const b = m.scoreInputs({ grossProfitUsd: 20, gasCostV1Usd: 5, optTradeUsd: 100 }).score;
    expect(b).toBeGreaterThan(a);
    const mw = new BaselineV2Model({ ...params, weightOptTrade: 0.5 });
    const c = mw.scoreInputs({ grossProfitUsd: 10, gasCostV1Usd: 5, optTradeUsd: 100 }).score;
    const d = mw.scoreInputs({ grossProfitUsd: 10, gasCostV1Usd: 5, optTradeUsd: 900 }).score;
    expect(d).toBeGreaterThan(c);
  });
  it("score(Features) — ścieżka ScoringModel — liczy dokładnie to, co scoreInputs (koszt gazu v1 = brutto − netto)", () => {
    const m = new BaselineV2Model(params);
    const f = { S: 1, G: 0.1, L: 10, M: 20, grossProfitUsd: 50, netProfitUsd: -30, optTradeUsd: 100 };
    expect(m.score(f)).toEqual(m.scoreInputs({ grossProfitUsd: 50, gasCostV1Usd: 80, optTradeUsd: 100 }));
    expect(m.score({ ...f, grossProfitUsd: 0, netProfitUsd: 0 }).score).toBe(0);
  });
  it("odrzuca niepoprawne parametry (threshold poza (0,1), scale ≤ 0)", () => {
    expect(() => new BaselineV2Model({ ...params, threshold: 1 })).toThrow();
    expect(() => new BaselineV2Model({ ...params, scale: 0 })).toThrow();
    expect(() => new BaselineV2Model({ ...params, arbGasRef: 0 })).toThrow();
  });
});

describe("bestF1Threshold", () => {
  it("wybiera cięcie o maksymalnym F1 (środek między wartościami), obcięte do (0,1)", () => {
    const v = [0.9, 0.8, 0.7, 0.2, 0.1];
    const actual = [true, true, false, false, false];
    const r = bestF1Threshold(v, actual);
    expect(r.f1).toBe(1);
    expect(r.threshold).toBeCloseTo(0.75, 9);
  });
  it("remisy v traktuje jako jedno cięcie", () => {
    const r = bestF1Threshold([0.5, 0.5, 0.5, 0.1], [true, true, false, false]);
    expect(r.f1).toBeCloseTo(0.8, 9); // cięcie ≥0.5: tp=2 fp=1 -> P=2/3 R=1
    expect(r.threshold).toBeCloseTo(0.3, 9);
  });
});

/**
 * Dane syntetyczne: „prawdziwy" koszt gazu bota = 0,5 × nasz szacunek v1 (boty ~153k gazu,
 * część w pakietach Flashbots). Etykieta = brutto − 0,5·kosztV1 + szum > 0. LCG własny — determinizm.
 */
function synthetic(n: number, seed: number, trueFactor = 0.5): BaselineV2CalibrationRow[] {
  let a = seed;
  const r = () => (a = (a * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  return Array.from({ length: n }, () => {
    const grossProfitUsd = r() * 200;
    const gasCostV1Usd = 20 + r() * 200;
    const optTradeUsd = 1000 + r() * 50_000;
    const noise = (r() - 0.5) * 30;
    return { grossProfitUsd, gasCostV1Usd, optTradeUsd, label: grossProfitUsd - trueFactor * gasCostV1Usd + noise > 0 };
  });
}

describe("calibrateBaselineV2", () => {
  it("na danych z tanim gazem wybiera gasPriceFactor < 1 (AUC lepsze niż przy pełnym koszcie v1), deterministycznie", () => {
    const rows = synthetic(2000, 11);
    const cal = calibrateBaselineV2(rows, { arbGasRef: ARB_GAS });
    expect(cal.params.gasPriceFactor).toBeLessThan(1);
    expect(cal.params.gasPriceFactor).toBeGreaterThan(0);
    expect(cal.params.arbGasRef).toBe(ARB_GAS);
    expect(cal.train.auc).toBeGreaterThan(0.9);
    expect(cal.grid).toHaveLength(2 * 5 * 3);

    // AUC wybranego punktu ≥ AUC każdego punktu siatki (w tym „v1": 220k, factor 1, bez rangi)
    const v1 = cal.grid.find((g) => g.gasUnits === 220_000 && g.gasPriceFactor === 1 && g.weightOptTrade === 0)!;
    expect(cal.train.auc).toBeGreaterThan(v1.auc);
    for (const g of cal.grid) expect(cal.train.auc).toBeGreaterThanOrEqual(g.auc);

    expect(calibrateBaselineV2(rows, { arbGasRef: ARB_GAS })).toEqual(cal);
  });

  it("ranga optTrade (weightOptTrade > 0) nie jest wybierana, gdy optTrade nie niesie informacji", () => {
    const cal = calibrateBaselineV2(synthetic(1500, 3), { arbGasRef: ARB_GAS });
    expect(cal.params.weightOptTrade).toBe(0);
    expect(cal.train.thresholdNetUsd).not.toBeNull();
  });

  it("wybiera rangę optTrade, gdy etykieta zależy głównie od optTrade", () => {
    let a = 5;
    const r = () => (a = (a * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const rows: BaselineV2CalibrationRow[] = Array.from({ length: 1500 }, () => {
      const optTradeUsd = r() * 100_000;
      return { grossProfitUsd: r() * 50, gasCostV1Usd: r() * 50, optTradeUsd, label: optTradeUsd + (r() - 0.5) * 20_000 > 50_000 };
    });
    const cal = calibrateBaselineV2(rows, { arbGasRef: ARB_GAS });
    expect(cal.params.weightOptTrade).toBeGreaterThan(0);
    expect(cal.train.thresholdNetUsd).toBeNull();
  });

  it("parametry wyjściowe odtwarzają AUC/F1 zbioru kalibracyjnego przez BaselineV2Model (próg 50)", () => {
    const rows = synthetic(800, 21);
    const cal = calibrateBaselineV2(rows, { arbGasRef: ARB_GAS });
    const m = new BaselineV2Model(cal.params);
    const scores = rows.map((x) => m.scoreInputs(x).score);
    const actual = rows.map((x) => x.label);
    expect(rocAuc(scores, actual)).toBeCloseTo(cal.train.auc, 9);
    const predicted = scores.map((s) => s >= 50);
    const tp = predicted.filter((p, i) => p && actual[i]).length;
    const fp = predicted.filter((p, i) => p && !actual[i]).length;
    const fn = actual.filter((y, i) => y && !predicted[i]).length;
    const f1 = (2 * tp) / (2 * tp + fp + fn);
    expect(f1).toBeCloseTo(cal.train.f1, 9);
  });

  it("rzuca, gdy zbiór kalibracyjny ma jedną klasę", () => {
    const rows = synthetic(50, 1).map((x) => ({ ...x, label: true }));
    expect(() => calibrateBaselineV2(rows, { arbGasRef: ARB_GAS })).toThrow(/obie klasy/);
  });
});
