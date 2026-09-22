import { describe, expect, it } from "vitest";
import { membership, membershipGrad, SQRT_2LN2, type GaussTerm } from "../../src/anfis/gaussian.js";

describe("membership", () => {
  it("full: 1 w środku, 0.5 w μ±σ·sqrt(2ln2)", () => {
    const t: GaussTerm = { mu: 0.9, sigma: 0.2, shape: "full" };
    expect(membership(t, 0.9)).toBe(1);
    expect(membership(t, 0.9 + 0.2 * SQRT_2LN2)).toBeCloseTo(0.5, 10);
    expect(membership(t, 0.9 - 0.2 * SQRT_2LN2)).toBeCloseTo(0.5, 10);
  });

  it("leftShoulder: plateau=1 dla x<=μ, opada w prawo", () => {
    const t: GaussTerm = { mu: 0.3, sigma: 0.15, shape: "leftShoulder" };
    expect(membership(t, -5)).toBe(1);
    expect(membership(t, 0.3)).toBe(1);
    expect(membership(t, 0.3 + 0.15 * SQRT_2LN2)).toBeCloseTo(0.5, 10);
  });

  it("rightShoulder: plateau=1 dla x>=μ, opada w lewo", () => {
    const t: GaussTerm = { mu: 1.8, sigma: 0.3, shape: "rightShoulder" };
    expect(membership(t, 3)).toBe(1);
    expect(membership(t, 1.8)).toBe(1);
    expect(membership(t, 1.8 - 0.3 * SQRT_2LN2)).toBeCloseTo(0.5, 10);
  });

  it("wartości mieszczą się w (0,1]", () => {
    const t: GaussTerm = { mu: 0, sigma: 1, shape: "full" };
    for (const x of [-10, -3, -1, 0, 1, 3, 10]) {
      const g = membership(t, x);
      expect(g).toBeGreaterThan(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });
});

describe("membershipGrad", () => {
  it("zgadza się z różnicą centralną (shape=full)", () => {
    const t: GaussTerm = { mu: 1, sigma: 0.4, shape: "full" };
    const x = 1.3;
    const h = 1e-6;
    const { dMu, dSigma } = membershipGrad(t, x);
    const numMu = (membership({ ...t, mu: t.mu + h }, x) - membership({ ...t, mu: t.mu - h }, x)) / (2 * h);
    const numSig =
      (membership({ ...t, sigma: t.sigma + h }, x) - membership({ ...t, sigma: t.sigma - h }, x)) / (2 * h);
    expect(dMu).toBeCloseTo(numMu, 6);
    expect(dSigma).toBeCloseTo(numSig, 6);
  });

  it("zgadza się z różnicą centralną poza plateau dla leftShoulder", () => {
    const t: GaussTerm = { mu: 0.3, sigma: 0.15, shape: "leftShoulder" };
    const x = 0.5; // x > mu, poza plateau
    const h = 1e-6;
    const { dMu, dSigma } = membershipGrad(t, x);
    const numMu = (membership({ ...t, mu: t.mu + h }, x) - membership({ ...t, mu: t.mu - h }, x)) / (2 * h);
    const numSig =
      (membership({ ...t, sigma: t.sigma + h }, x) - membership({ ...t, sigma: t.sigma - h }, x)) / (2 * h);
    expect(dMu).toBeCloseTo(numMu, 6);
    expect(dSigma).toBeCloseTo(numSig, 6);
  });

  it("zgadza się z różnicą centralną poza plateau dla rightShoulder", () => {
    const t: GaussTerm = { mu: 1.8, sigma: 0.3, shape: "rightShoulder" };
    const x = 1.2; // x < mu, poza plateau
    const h = 1e-6;
    const { dMu, dSigma } = membershipGrad(t, x);
    const numMu = (membership({ ...t, mu: t.mu + h }, x) - membership({ ...t, mu: t.mu - h }, x)) / (2 * h);
    const numSig =
      (membership({ ...t, sigma: t.sigma + h }, x) - membership({ ...t, sigma: t.sigma - h }, x)) / (2 * h);
    expect(dMu).toBeCloseTo(numMu, 6);
    expect(dSigma).toBeCloseTo(numSig, 6);
  });

  it("na plateau (leftShoulder) gradient = 0, g = 1", () => {
    const { dMu, dSigma, g } = membershipGrad({ mu: 2, sigma: 1, shape: "leftShoulder" }, 1);
    expect([g, dMu, dSigma]).toEqual([1, 0, 0]);
  });

  it("na plateau (rightShoulder) gradient = 0, g = 1", () => {
    const { dMu, dSigma, g } = membershipGrad({ mu: 2, sigma: 1, shape: "rightShoulder" }, 3);
    expect([g, dMu, dSigma]).toEqual([1, 0, 0]);
  });

  it("na granicy plateau (x=μ) gradient = 0", () => {
    const left = membershipGrad({ mu: 2, sigma: 1, shape: "leftShoulder" }, 2);
    expect([left.g, left.dMu, left.dSigma]).toEqual([1, 0, 0]);
    const right = membershipGrad({ mu: 2, sigma: 1, shape: "rightShoulder" }, 2);
    expect([right.g, right.dMu, right.dSigma]).toEqual([1, 0, 0]);
  });
});
