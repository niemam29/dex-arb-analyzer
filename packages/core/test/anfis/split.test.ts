import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../src/anfis/random.js";
import { splitStratified, splitStratifiedGroups } from "../../src/anfis/split.js";

describe("splitStratified", () => {
  it("zachowuje proporcje klas i rozłączność zbiorów", () => {
    const labels = [...Array(90).fill(0), ...Array(10).fill(1)];
    const { train, val } = splitStratified(labels, 0.2, mulberry32(3));
    expect(train.length + val.length).toBe(100);
    expect(new Set([...train, ...val]).size).toBe(100);
    expect(val.filter((i) => labels[i] === 1).length).toBe(2);
    expect(val.length).toBe(20);
  });

  it("jest deterministyczny dla tego samego seeda", () => {
    const labels = [...Array(50).fill(0), ...Array(50).fill(1)];
    const a = splitStratified(labels, 0.3, mulberry32(11));
    const b = splitStratified(labels, 0.3, mulberry32(11));
    expect(a).toEqual(b);
  });

  it("działa dla wielu klas (>2)", () => {
    const labels = [...Array(30).fill(0), ...Array(30).fill(1), ...Array(30).fill(2)];
    const { train, val } = splitStratified(labels, 0.1, mulberry32(1));
    expect(train.length + val.length).toBe(90);
    for (const cls of [0, 1, 2]) {
      expect(val.filter((i) => labels[i] === cls).length).toBe(3);
    }
  });
});

/**
 * Buduje syntetyczny zbiór z grupami naśladujący realny kształt danych (`computeGroupKeys`):
 * `nBgGroups` singletonów tła (etykieta 0), `nPosGroups` grup po `posGroupSize` próbek — w każdej
 * jedna próbka ma etykietę 0 (żeby sprawdzić, że stratyfikacja jest po `hasPositive` grupy, nie po
 * pojedynczej etykiecie), reszta etykietę 1.
 */
function syntheticGroups(
  nBgGroups: number,
  nPosGroups: number,
  posGroupSize: number,
): { labels: number[]; groups: string[] } {
  const labels: number[] = [];
  const groups: string[] = [];
  for (let g = 0; g < nBgGroups; g++) {
    labels.push(0);
    groups.push(`bg:${g}`);
  }
  for (let g = 0; g < nPosGroups; g++) {
    for (let j = 0; j < posGroupSize; j++) {
      labels.push(j === 0 ? 0 : 1);
      groups.push(`pos:${g}`);
    }
  }
  return { labels, groups };
}

describe("splitStratifiedGroups", () => {
  it("żadna grupa nie jest rozdzielona między train i val", () => {
    const { labels, groups } = syntheticGroups(400, 20, 3);
    const { train, val } = splitStratifiedGroups(labels, groups, 0.2, mulberry32(5));

    const groupOf = new Map<number, string>();
    train.forEach((i) => groupOf.set(i, "train"));
    val.forEach((i) => groupOf.set(i, "val"));

    const bucketByGroup = new Map<string, Set<string>>();
    groups.forEach((g, i) => {
      const bucket = groupOf.get(i)!;
      const s = bucketByGroup.get(g);
      if (s) s.add(bucket);
      else bucketByGroup.set(g, new Set([bucket]));
    });
    for (const buckets of bucketByGroup.values()) {
      expect(buckets.size).toBe(1);
    }
    expect(train.length + val.length).toBe(labels.length);
    expect(new Set([...train, ...val]).size).toBe(labels.length);
  });

  it("ułamek pozytywów w val jest zbliżony do valFraction", () => {
    const { labels, groups } = syntheticGroups(400, 40, 5);
    const totalPos = labels.filter((y) => y === 1).length;
    const { val } = splitStratifiedGroups(labels, groups, 0.2, mulberry32(7));
    const valPos = val.filter((i) => labels[i] === 1).length;
    expect(valPos / totalPos).toBeGreaterThan(0.1);
    expect(valPos / totalPos).toBeLessThan(0.3);
  });

  it("jest deterministyczny dla tego samego seeda", () => {
    const { labels, groups } = syntheticGroups(200, 15, 4);
    const a = splitStratifiedGroups(labels, groups, 0.25, mulberry32(13));
    const b = splitStratifiedGroups(labels, groups, 0.25, mulberry32(13));
    expect(a).toEqual(b);
  });

  it("rzuca błąd, gdy labels i groups mają różną długość", () => {
    expect(() => splitStratifiedGroups([0, 1], ["a"], 0.2, mulberry32(1))).toThrow();
  });
});
