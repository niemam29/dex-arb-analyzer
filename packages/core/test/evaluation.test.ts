import { describe, expect, it } from "vitest";
import {
  averagePrecision,
  bootstrapAucCi,
  confusionMatrix,
  evaluateScores,
  precisionRecallF1,
  rocAuc,
  rocCurve,
  scoreHistogram,
  thresholdOptF1,
} from "../src/evaluation.js";

describe("confusionMatrix / precisionRecallF1", () => {
  it("liczy TP/FP/TN/FN i metryki", () => {
    const cm = confusionMatrix([true, true, false, false, true], [true, false, false, true, true]);
    expect(cm).toEqual({ tp: 2, fp: 1, tn: 1, fn: 1 });
    const m = precisionRecallF1(cm);
    expect(m.precision).toBeCloseTo(2 / 3);
    expect(m.recall).toBeCloseTo(2 / 3);
    expect(m.f1).toBeCloseTo(2 / 3);
    expect(m.accuracy).toBeCloseTo(3 / 5);
  });
  it("0 zamiast NaN przy pustych mianownikach", () => {
    expect(precisionRecallF1({ tp: 0, fp: 0, tn: 5, fn: 0 })).toEqual({ precision: 0, recall: 0, f1: 0, accuracy: 1 });
  });
  it("rzuca przy różnych długościach", () => {
    expect(() => confusionMatrix([true], [])).toThrow();
  });
});

describe("rocAuc", () => {
  it("1 dla idealnej separacji, 0 dla odwrotnej, 0.5 dla stałych score", () => {
    expect(rocAuc([90, 80, 20, 10], [true, true, false, false])).toBe(1);
    expect(rocAuc([90, 80, 20, 10], [false, false, true, true])).toBe(0);
    expect(rocAuc([50, 50, 50, 50], [true, false, true, false])).toBe(0.5);
  });
  it("remisy liczone po 0.5; przykład ręczny", () => {
    // pozytywy: 70, 50 ; negatywy: 50, 30 -> pary: (70>50)=1,(70>30)=1,(50=50)=.5,(50>30)=1 -> 3.5/4
    expect(rocAuc([70, 50, 50, 30], [true, true, false, false])).toBeCloseTo(0.875);
  });
  it("NaN gdy tylko jedna klasa", () => {
    expect(rocAuc([1, 2], [true, true])).toBeNaN();
  });
});

describe("scoreHistogram", () => {
  it("20 kubełków 0–100, wartość 100 w ostatnim", () => {
    const h = scoreHistogram([0, 4.9, 5, 99, 100], 20);
    expect(h.edges).toHaveLength(21);
    expect(h.counts[0]).toBe(2);
    expect(h.counts[1]).toBe(1);
    expect(h.counts[19]).toBe(2);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(5);
  });

  it("bez `actual` nie zwraca positive/negative", () => {
    const h = scoreHistogram([1, 2, 3]);
    expect(h.positive).toBeUndefined();
    expect(h.negative).toBeUndefined();
  });

  it("z `actual`: positive/negative sumują się do liczności klas, counts = positive+negative", () => {
    const scores = [10, 20, 30, 40, 60, 70, 80, 90];
    const actual = [false, false, false, true, false, true, true, true];
    const h = scoreHistogram(scores, 20, 0, 100, actual);
    expect(h.positive!.reduce((a, b) => a + b, 0)).toBe(4);
    expect(h.negative!.reduce((a, b) => a + b, 0)).toBe(4);
    for (let i = 0; i < h.counts.length; i++) expect(h.counts[i]).toBe(h.positive![i]! + h.negative![i]!);
  });

  it("rzuca, gdy `actual` ma inną długość niż `scores`", () => {
    expect(() => scoreHistogram([1, 2, 3], 20, 0, 100, [true, false])).toThrow();
  });
});

describe("rocCurve", () => {
  const scores = [10, 20, 30, 40, 60, 70, 80, 90];
  const actual = [false, false, false, true, false, true, true, true];

  it("zaczyna w (0,0), kończy w (1,1), monotoniczna niemalejąco, długości równe", () => {
    const r = rocCurve(scores, actual);
    expect(r.fpr[0]).toBe(0);
    expect(r.tpr[0]).toBe(0);
    expect(r.fpr.at(-1)).toBe(1);
    expect(r.tpr.at(-1)).toBe(1);
    expect(r.fpr.length).toBe(r.tpr.length);
    expect(r.fpr.length).toBe(r.thresholds.length);
    for (let i = 1; i < r.fpr.length; i++) {
      expect(r.fpr[i]!).toBeGreaterThanOrEqual(r.fpr[i - 1]!);
      expect(r.tpr[i]!).toBeGreaterThanOrEqual(r.tpr[i - 1]!);
    }
  });

  it("ręczny przykład: idealna separacja [1,2|3,4]", () => {
    const r = rocCurve([1, 2, 3, 4], [false, false, true, true]);
    expect(r.fpr).toEqual([0, 0, 0, 0.5, 1]);
    expect(r.tpr).toEqual([0, 0.5, 1, 1, 1]);
  });

  it("remisy: wartości identyczne dają jeden punkt zbiorczy", () => {
    const r = rocCurve([5, 5, 5, 5], [true, false, true, false]);
    expect(r.fpr).toEqual([0, 1]);
    expect(r.tpr).toEqual([0, 1]);
  });

  it("pole pod krzywą metodą trapezów ≈ rocAuc (spójność)", () => {
    const r = rocCurve(scores, actual);
    let area = 0;
    for (let i = 1; i < r.fpr.length; i++) {
      const dx = r.fpr[i]! - r.fpr[i - 1]!;
      area += (dx * (r.tpr[i]! + r.tpr[i - 1]!)) / 2;
    }
    expect(area).toBeCloseTo(rocAuc(scores, actual), 10);
  });

  it("rzuca przy różnych długościach", () => {
    expect(() => rocCurve([1, 2], [true])).toThrow();
  });
});

describe("evaluateScores", () => {
  it("składa wszystko w podsumowanie", () => {
    const s = evaluateScores([90, 10, 60, 40], [true, false, true, false], [true, false, false, true]);
    expect(s.n).toBe(4);
    expect(s.positives).toBe(2);
    expect(s.cm).toEqual({ tp: 1, fp: 1, tn: 1, fn: 1 });
    // Pozytywy: 90, 40; negatywy: 10, 60 -> pary: (90>10)=1,(90>60)=1,(40>10)=1,(40<60)=0 -> 3/4.
    expect(s.auc).toBeCloseTo(0.75);
  });

  it("histogram niesie positive/negative per kubełek", () => {
    const s = evaluateScores([90, 10, 60, 40], [true, false, true, false], [true, false, false, true]);
    expect(s.histogram.positive).toBeDefined();
    expect(s.histogram.negative).toBeDefined();
    expect(s.histogram.positive.reduce((a, b) => a + b, 0)).toBe(2);
    expect(s.histogram.negative.reduce((a, b) => a + b, 0)).toBe(2);
    for (let i = 0; i < s.histogram.counts.length; i++) {
      expect(s.histogram.counts[i]).toBe(s.histogram.positive[i]! + s.histogram.negative[i]!);
    }
  });
});

describe("bootstrapAucCi", () => {
  it("idealny klasyfikator: CI = [1, 1]; null gdy jedna klasa", () => {
    expect(bootstrapAucCi([90, 80, 20, 10], [true, true, false, false], { n: 200 })).toEqual([1, 1]);
    expect(bootstrapAucCi([1, 2, 3], [true, true, true])).toBeNull();
  });
  it("losowe score: CI obejmuje 0,5 i jest deterministyczne dla seeda", () => {
    const rng = (() => {
      let s = 7;
      return () => (s = (s * 48271) % 2147483647) / 2147483647;
    })();
    const scores = Array.from({ length: 400 }, () => rng() * 100);
    const actual = Array.from({ length: 400 }, (_, i) => i % 4 === 0);
    const ci = bootstrapAucCi(scores, actual, { n: 300, seed: 1 })!;
    expect(ci[0]).toBeLessThan(0.5);
    expect(ci[1]).toBeGreaterThan(0.5);
    expect(ci[1] - ci[0]).toBeLessThan(0.3);
    expect(bootstrapAucCi(scores, actual, { n: 300, seed: 1 })).toEqual(ci);
    expect(bootstrapAucCi(scores, actual, { n: 300, seed: 2 })).not.toEqual(ci);
  });
  it("CI zawiera punktowe AUC i mieści się w [0,1]", () => {
    const scores = [90, 70, 50, 50, 30, 10];
    const actual = [true, false, true, false, true, false];
    const ci = bootstrapAucCi(scores, actual, { n: 500 })!;
    const auc = rocAuc(scores, actual);
    expect(ci[0]).toBeLessThanOrEqual(auc);
    expect(ci[1]).toBeGreaterThanOrEqual(auc);
    expect(ci[0]).toBeGreaterThanOrEqual(0);
    expect(ci[1]).toBeLessThanOrEqual(1);
  });
});

describe("averagePrecision", () => {
  it("1 dla idealnej separacji; 5/12 dla odwrotnej (ręczny rachunek); NaN bez pozytywów", () => {
    expect(averagePrecision([90, 80, 20, 10], [true, true, false, false])).toBe(1);
    // ranking malejąco: F, F, T (P=1/3, R=1/2), T (P=2/4, R=1) -> 1/2·1/3 + 1/2·1/2 = 5/12
    expect(averagePrecision([90, 80, 20, 10], [false, false, true, true])).toBeCloseTo(5 / 12, 12);
    expect(averagePrecision([1, 2], [false, false])).toBeNaN();
  });
  it("remisy scalone: dwa równe score liczone jako jeden punkt", () => {
    // 50 (T), 50 (F) razem: tp=1, fp=1 -> P=1/2, R=1 -> AP = 1·1/2
    expect(averagePrecision([50, 50, 10], [true, false, false])).toBeCloseTo(0.5, 12);
  });
});

describe("thresholdOptF1", () => {
  it("wybiera cięcie o max F1 i zwraca środek między nim a następnym niższym score", () => {
    const r = thresholdOptF1([90, 80, 60, 40, 20, 10], [true, true, false, true, false, false]);
    // cięcia: 90 F1=0,5; 80 0,8; 60 0,667; 40 0,857; 20 0,75; 10 0,667 -> cięcie 40, próg (40+20)/2
    expect(r.threshold).toBe(30);
    expect(r.f1).toBeCloseTo(6 / 7, 12);
  });
  it("same pozytywy: najniższe cięcie daje F1=1, brak niższego score -> próg równy cięciu; remis F1 -> najwyższe cięcie", () => {
    // [70, 30] oba T: cięcie 70 -> recall 0,5, F1 2/3; cięcie 30 -> F1 1; brak niższego -> próg 30
    expect(thresholdOptF1([70, 30], [true, true])).toEqual({ threshold: 30, f1: 1 });
    // [90 T, 50 F, 10 F]: cięcie 90 F1=1, cięcie 50 F1=2/3 -> próg (90+50)/2
    expect(thresholdOptF1([90, 50, 10], [true, false, false]).threshold).toBe(70);
  });
  it("rzuca przy różnych długościach", () => {
    expect(() => thresholdOptF1([1], [])).toThrow();
  });
});
