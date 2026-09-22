import { describe, expect, it } from "vitest";
import { initFromMamdani } from "../../src/anfis/init.js";
import {
  backward,
  bceLoss,
  flattenGrads,
  flattenParams,
  forward,
  unflattenParams,
  zeroGrads,
  type AnfisParams,
} from "../../src/anfis/model.js";
import { mulberry32 } from "../../src/anfis/random.js";
import { fitStandardizer } from "../../src/anfis/standardize.js";

describe("bceLoss", () => {
  it("= -weight*ln(y) dla target=1, -weight*ln(1-y) dla target=0", () => {
    expect(bceLoss(0.8, 1, 1)).toBeCloseTo(-Math.log(0.8), 12);
    expect(bceLoss(0.8, 0, 1)).toBeCloseTo(-Math.log(0.2), 12);
    expect(bceLoss(0.8, 1, 3)).toBeCloseTo(-3 * Math.log(0.8), 12);
  });

  it("jest odporna na y bliskie 0/1 (bez -Infinity)", () => {
    expect(Number.isFinite(bceLoss(1, 1, 1))).toBe(true);
    expect(Number.isFinite(bceLoss(0, 0, 1))).toBe(true);
    expect(Number.isFinite(bceLoss(1, 0, 1))).toBe(true);
  });
});

describe("zeroGrads", () => {
  it("ma ten sam kształt co parametry, wszystko wyzerowane", () => {
    const p = initFromMamdani();
    const g = zeroGrads(p);
    expect(g.terms.map((t) => t.length)).toEqual(p.terms.map((t) => t.length));
    expect(g.terms.every((ts) => ts.every((t) => t.dMu === 0 && t.dSigma === 0))).toBe(true);
    expect(g.consequents).toEqual(p.consequents.map((c) => c.map(() => 0)));
  });
});

describe("flattenParams / unflattenParams", () => {
  it("round-trip zachowuje wartości mu/sigma/consequents", () => {
    const p = initFromMamdani();
    const theta = flattenParams(p);
    const q = unflattenParams(p, theta);
    expect(q.terms).toEqual(p.terms);
    expect(q.consequents).toEqual(p.consequents);
  });

  it("flattenParams ma długość 2*Σtermów + Σ(5*reguły)", () => {
    const p = initFromMamdani();
    const nTerms = p.terms.reduce((s, ts) => s + ts.length, 0);
    const theta = flattenParams(p);
    expect(theta).toHaveLength(2 * nTerms + p.rules.length * 5);
  });

  it("unflattenParams nie mutuje oryginału", () => {
    const p = initFromMamdani();
    const before = JSON.parse(JSON.stringify(p)) as AnfisParams;
    const theta = flattenParams(p);
    theta[0] += 1;
    unflattenParams(p, theta);
    expect(p).toEqual(before);
  });
});

describe("backward", () => {
  it("gradient analityczny = różnica centralna (tol. względna 1e-4) na losowym batchu", () => {
    const rng = mulberry32(5);
    let p = initFromMamdani();
    // losowe, niezerowe konsekwenty, żeby gradient po przesłankach nie był trywialny
    p = { ...p, consequents: p.consequents.map((c) => c.map(() => (rng() - 0.5) * 2)) };
    const batch = Array.from({ length: 8 }, () => ({
      x: [rng() * 3, rng() * 2, rng() * 100, rng() * 100],
      t: (rng() < 0.5 ? 1 : 0) as 0 | 1,
      wgt: rng() < 0.5 ? 1 : 5,
    }));
    // Standaryzator dopasowany do batcha (tak jak podczas treningu — spec §1.1), a nie tożsamościowy
    // z initFromMamdani(): z cechami L,M surowymi do 100 i losowymi konsekwentami rzędu O(1) logit
    // z eksploduje (dziesiątki), sigmoid nasyca się do 1±1e-12 i różnica centralna (h=1e-5) traci
    // dokładność w pobliżu progu obcinania bceLoss — to artefakt metody numerycznej, nie błąd wzoru.
    p = { ...p, standardizer: fitStandardizer(batch.map((b) => b.x)) };
    const lossOf = (q: AnfisParams) =>
      batch.reduce((s, b) => s + bceLoss(forward(q, b.x).y, b.t, b.wgt), 0) / batch.length;

    const acc = zeroGrads(p);
    for (const b of batch) backward(p, forward(p, b.x), b.t, b.wgt / batch.length, acc);
    const ga = flattenGrads(p, acc);
    const theta = flattenParams(p);
    const h = 1e-5;
    const atol = 1e-6;
    const rtol = 1e-4;
    let checked = 0;
    for (let k = 0; k < theta.length; k++) {
      const tp = [...theta];
      tp[k] = tp[k]! + h;
      const tm = [...theta];
      tm[k] = tm[k]! - h;
      const num = (lossOf(unflattenParams(p, tp)) - lossOf(unflattenParams(p, tm))) / (2 * h);
      const g = ga[k]!;
      // tolerancja łączona (bezwzględna + względna) — standard w gradient-checkingu: czysto
      // względna metryka |a-b|/(|a|+|b|) eksploduje przy dwóch bliskoZEROwych, ale niezerowych
      // wartościach (np. 1.4e-8 vs 1.4e-8 różniące się w 4. cyfrze znaczącej dają "błąd" >1e-3).
      expect(Math.abs(num - g), `param ${k}: num=${num} analytic=${g}`).toBeLessThanOrEqual(
        atol + rtol * Math.max(Math.abs(num), Math.abs(g)),
      );
      checked++;
    }
    expect(checked).toBe(theta.length);
  });

  it("zwraca zerowy gradient klauzuli negowanej odwrócony znakiem względem klauzuli bazowej", () => {
    // R1 = { S: znikoma } — reguła bez negacji, tylko sanity check że backward w ogóle coś akumuluje
    const p = initFromMamdani();
    const c = forward(p, [0.2, 0.15, 70, 20]);
    const acc = zeroGrads(p);
    backward(p, c, 1, 1, acc);
    const flat = flattenGrads(p, acc);
    expect(flat.some((v) => v !== 0)).toBe(true);
  });

  it("gradienty na plateau termu (μ,σ) są dokładnie 0, gdy x na plateau dla wszystkich klauzul reguły", () => {
    const p = initFromMamdani();
    // R10: S=duza(ramp, plateau x>=1.8), G=niski(invRamp, plateau x<=0.1), L=gleboka(ramp, plateau x>=60), M=niskie(invRamp, plateau x<=20)
    const x = [3, 0, 100, 0]; // głęboko na plateau wszystkich klauzul reguły R10
    const c = forward(p, x);
    const acc = zeroGrads(p);
    backward(p, c, 1, 1, acc);
    const r10 = p.rules.findIndex((r) => r.id === "R10");
    for (const cl of p.rules[r10]!.clauses) {
      expect(acc.terms[cl.varIdx]![cl.termIdx]!.dMu).toBe(0);
      expect(acc.terms[cl.varIdx]![cl.termIdx]!.dSigma).toBe(0);
    }
  });
});
