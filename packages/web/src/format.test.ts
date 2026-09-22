// packages/web/src/format.test.ts
// Wspólne formatery liczb (pl-PL) — przeniesione z OpportunityTable; separatorem tysięcy w pl-PL
// jest twarda spacja (U+00A0), którą normalizujemy do zwykłej, żeby asercje były czytelne.
import { it, expect } from "vitest";
import { fmtUsd, fmtPct, fmtInt, fmtBlock, shortHash, median, fmtAucCi, fmtDateUtc } from "./format";

// eslint-disable-next-line no-irregular-whitespace
const sp = (s: string) => s.replace(/ /g, " ");

it("fmtUsd: null -> myślnik, liczba z max 2 miejscami i sufiksem $", () => {
  expect(fmtUsd(null)).toBe("—");
  expect(fmtUsd(undefined)).toBe("—");
  expect(fmtUsd(20.5)).toBe("20,5 $");
  expect(sp(fmtUsd(1234567.891))).toBe("1 234 567,89 $");
});

it("fmtPct: domyślnie 3 miejsca, opcjonalnie inna liczba miejsc", () => {
  expect(fmtPct(0.65)).toBe("0,650 %");
  expect(fmtPct(12.3456, 1)).toBe("12,3 %");
});

it("fmtInt: grupowanie tysięcy, null -> myślnik", () => {
  expect(sp(fmtInt(12430000))).toBe("12 430 000");
  expect(fmtInt(0)).toBe("0");
  expect(fmtInt(null)).toBe("—");
});

it("fmtBlock: numer bloku bez grupowania (identyfikator), null -> myślnik", () => {
  expect(fmtBlock(12430000)).toBe("12430000");
  expect(fmtBlock(null)).toBe("—");
});

it("shortHash: skraca długie hashe z wielokropkiem, krótkie zostawia", () => {
  expect(shortHash("0xabc")).toBe("0xabc");
  expect(shortHash("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x123456…345678");
  expect(shortHash("0x1234567890abcdef1234567890abcdef12345678", 4)).toBe("0x1234…5678");
});

it("median: pusta -> null, nieparzysta/parzysta liczba elementów", () => {
  expect(median([])).toBeNull();
  expect(median([3, 1, 2])).toBe(2);
  expect(median([4, 1, 3, 2])).toBe(2.5);
});

it("fmtAucCi: AUC z przedziałem [low–high] po przecinku dziesiętnym; bez CI sam AUC; null -> myślnik", () => {
  expect(fmtAucCi(0.8181, [0.7912, 0.8477])).toBe("0,818 [0,79–0,85]");
  expect(fmtAucCi(0.5, null)).toBe("0,500");
  expect(fmtAucCi(null, null)).toBe("—");
});

it("fmtDateUtc: data i czas w UTC z jawną etykietą, niezależnie od strefy maszyny", () => {
  expect(fmtDateUtc("2021-05-14T00:00:00Z")).toBe("14.05.2021, 00:00 UTC");
  expect(fmtDateUtc("2022-11-18T23:59:30.000Z")).toBe("18.11.2022, 23:59 UTC");
  expect(fmtDateUtc(null)).toBe("—");
});