import { describe, expect, it } from "vitest";
import { predict } from "../../src/anfis/model.js";
import { mulberry32 } from "../../src/anfis/random.js";
import { trainAnfis } from "../../src/anfis/train.js";
import { rocAuc } from "../../src/evaluation.js";

function synthetic(n: number, seed: number): { X: number[][]; y: (0 | 1)[] } {
  const rng = mulberry32(seed);
  const X: number[][] = [];
  const y: (0 | 1)[] = [];
  for (let i = 0; i < n; i++) {
    const x = [rng() * 3, rng() * 2, rng() * 100, rng() * 100];
    X.push(x);
    y.push(x[0]! > 1 && x[1]! < 0.5 ? 1 : 0);
  }
  return { X, y };
}

describe("trainAnfis", () => {
  it("uczy się label = S>1 ∧ G<0.5 do AUC > 0.95 na próbce testowej, strata walidacyjna maleje", async () => {
    const tr = synthetic(4000, 1);
    const te = synthetic(1000, 2);
    const res = await trainAnfis(tr.X, tr.y, { epochs: 60, seed: 3 });
    const scores = te.X.map((x) => predict(res.params, x));
    expect(rocAuc(scores, te.y.map(Boolean))).toBeGreaterThan(0.95);
    expect(res.history.length).toBeLessThanOrEqual(60);
    expect(res.history.at(-1)!.valLoss).toBeLessThan(res.history[0]!.valLoss);
  }, 60_000);

  it("ten sam seed ⇒ identyczne parametry (determinizm)", async () => {
    const d = synthetic(500, 4);
    const a = await trainAnfis(d.X, d.y, { epochs: 5, seed: 9 });
    const b = await trainAnfis(d.X, d.y, { epochs: 5, seed: 9 });
    expect(a.params).toEqual(b.params);
  });

  it("wagi klas 'balanced': pos·N_pos = neg·N_neg", async () => {
    const d = synthetic(1000, 5);
    const nPos = d.y.filter((v) => v === 1).length;
    const r = await trainAnfis(d.X, d.y, { epochs: 1, seed: 1 });
    expect(r.classWeights.pos * nPos).toBeCloseTo(r.classWeights.neg * (1000 - nPos), 6);
  });

  it("classWeights: 'none' daje wagi 1/1", async () => {
    const d = synthetic(300, 7);
    const r = await trainAnfis(d.X, d.y, { epochs: 1, seed: 1, classWeights: "none" });
    expect(r.classWeights).toEqual({ pos: 1, neg: 1 });
  });

  it("σ nie spada poniżej 1% domeny", async () => {
    const d = synthetic(800, 6);
    const r = await trainAnfis(d.X, d.y, { epochs: 20, seed: 2, lr: 0.5 });
    r.params.terms.forEach((ts, j) =>
      ts.forEach((t) =>
        expect(t.sigma).toBeGreaterThanOrEqual(0.01 * (r.params.domains[j]![1]! - r.params.domains[j]![0]!) - 1e-12),
      ),
    );
  });

  it("nTrain + nVal = liczba próbek, podział ~80/20", async () => {
    const d = synthetic(500, 8);
    const r = await trainAnfis(d.X, d.y, { epochs: 1, seed: 1, valFraction: 0.2 });
    expect(r.nTrain + r.nVal).toBe(500);
    expect(r.nVal).toBeCloseTo(100, 0);
  });

  it("early stopping: bestEpoch <= history.length, historia nie przekracza epochs", async () => {
    const d = synthetic(600, 10);
    const r = await trainAnfis(d.X, d.y, { epochs: 40, seed: 11, patience: 3 });
    expect(r.bestEpoch).toBeLessThanOrEqual(r.history.length);
    expect(r.history.length).toBeLessThanOrEqual(40);
  });

  it("nie mutuje przekazanego init", async () => {
    const d = synthetic(300, 12);
    const init = (await trainAnfis(d.X, d.y, { epochs: 1, seed: 1 })).params;
    const before = JSON.parse(JSON.stringify(init));
    await trainAnfis(d.X, d.y, { epochs: 5, seed: 2, init });
    expect(init).toEqual(before);
  });

  it("strata treningowa maleje w trakcie uczenia (brak rozbieżności)", async () => {
    const d = synthetic(1500, 13);
    const r = await trainAnfis(d.X, d.y, { epochs: 30, seed: 14 });
    expect(r.history.at(-1)!.trainLoss).toBeLessThan(r.history[0]!.trainLoss);
  });

  it("rzuca błąd dla pustego lub niespójnego zbioru", async () => {
    await expect(trainAnfis([], [])).rejects.toThrow();
    await expect(trainAnfis([[1, 2, 3, 4]], [0, 1] as (0 | 1)[])).rejects.toThrow();
  });

  it("opts.groups: trening przebiega i jest deterministyczny (podział train/val świadomy grup)", async () => {
    const d = synthetic(600, 15);
    // Grupy po 3 sąsiednie próbki (naśladuje `computeGroupKeys` — okazje tej samej konsumującej
    // transakcji trafiają razem do train albo do val, nigdy rozdzielone).
    const groups = d.X.map((_, i) => `g:${Math.floor(i / 3)}`);

    const a = await trainAnfis(d.X, d.y, { epochs: 5, seed: 21, groups });
    const b = await trainAnfis(d.X, d.y, { epochs: 5, seed: 21, groups });
    expect(a.params).toEqual(b.params);
    expect(a.nTrain + a.nVal).toBe(600);
    expect(a.history.length).toBeGreaterThan(0);
  });

  it("opts.groups z niepoprawną długością rzuca błąd", async () => {
    const d = synthetic(50, 16);
    await expect(trainAnfis(d.X, d.y, { epochs: 1, seed: 1, groups: ["a", "b"] })).rejects.toThrow();
  });

  it("onEpoch: czeka na asynchroniczny callback (kolejność epok) i przerywa trening, gdy callback rzuci", async () => {
    const d = synthetic(300, 17);
    const seen: number[] = [];
    await trainAnfis(d.X, d.y, {
      epochs: 4,
      seed: 1,
      onEpoch: async (h) => {
        await new Promise((r) => setTimeout(r, 1));
        seen.push(h.epoch);
      },
    });
    expect(seen).toEqual([1, 2, 3, 4]);

    await expect(
      trainAnfis(d.X, d.y, { epochs: 10, seed: 1, onEpoch: (h) => { if (h.epoch === 2) throw new Error("stop"); } }),
    ).rejects.toThrow("stop");
  });

  it("onEpoch asynchroniczne nie zmienia wyniku (identyczne parametry jak bez callbacka)", async () => {
    const d = synthetic(400, 18);
    const a = await trainAnfis(d.X, d.y, { epochs: 5, seed: 3 });
    const b = await trainAnfis(d.X, d.y, { epochs: 5, seed: 3, onEpoch: () => new Promise((r) => setTimeout(r, 1)) });
    expect(b.params).toEqual(a.params);
  });
});
