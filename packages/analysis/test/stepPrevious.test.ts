import { describe, expect, it } from "vitest";
import { stepPrevious } from "../src/stepPrevious.js";

describe("stepPrevious (ostatnia znana wartość <= zapytanego bloku — krok wstecz)", () => {
  const at = stepPrevious([100, 105, 110], [4000, 4100, 3900]);

  it("dokładny punkt", () => expect(at(105)).toBe(4100));
  it("między punktami -> ostatni wcześniejszy", () => {
    expect(at(107)).toBe(4100);
    expect(at(104)).toBe(4000);
  });
  it("po ostatnim punkcie -> ostatnia wartość (forward-fill)", () => expect(at(10_000)).toBe(3900));
  it("dokładnie pierwszy punkt -> pierwsza wartość", () => expect(at(100)).toBe(4000));
  it("przed pierwszym punktem -> pierwsza wartość (bez ekstrapolacji wstecz)", () => expect(at(50)).toBe(4000));

  it("nieposortowane wejście jest sortowane", () => {
    const at2 = stepPrevious([5, 1], [2, 1]);
    expect(at2(3)).toBe(1);
    expect(at2(0)).toBe(1);
    expect(at2(9)).toBe(2);
  });

  it("pusta seria -> rzuca", () => {
    expect(() => stepPrevious([], [])).toThrow(/brak próbek/);
  });

  it("różna długość xs/ys -> rzuca", () => {
    expect(() => stepPrevious([1, 2], [1])).toThrow(/tę samą długość/);
  });
});
