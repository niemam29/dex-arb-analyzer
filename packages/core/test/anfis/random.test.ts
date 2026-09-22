import { describe, expect, it } from "vitest";
import { mulberry32, shuffleInPlace } from "../../src/anfis/random.js";

describe("mulberry32", () => {
  it("jest deterministyczny dla tego samego seeda", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("różne seedy dają różne ciągi", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("zwraca liczby z przedziału [0,1)", () => {
    const r = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("shuffleInPlace", () => {
  it("daje permutację (te same elementy, ten sam rozmiar)", () => {
    const arr = Array.from({ length: 20 }, (_, i) => i);
    shuffleInPlace(arr, mulberry32(42));
    expect(arr).toHaveLength(20);
    expect([...arr].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it("jest deterministyczne dla tego samego seeda", () => {
    const a = Array.from({ length: 10 }, (_, i) => i);
    const b = Array.from({ length: 10 }, (_, i) => i);
    shuffleInPlace(a, mulberry32(5));
    shuffleInPlace(b, mulberry32(5));
    expect(a).toEqual(b);
  });

  it("zwykle zmienia kolejność (nie jest tożsamością) dla dostatecznie dużej tablicy", () => {
    const arr = Array.from({ length: 20 }, (_, i) => i);
    const original = [...arr];
    shuffleInPlace(arr, mulberry32(42));
    expect(arr).not.toEqual(original);
  });
});
