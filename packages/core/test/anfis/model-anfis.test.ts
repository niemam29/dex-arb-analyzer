import { describe, expect, it } from "vitest";
import { initFromMamdani } from "../../src/anfis/init.js";
import { AnfisModel } from "../../src/anfis/model.js";
import { labelForScore } from "../../src/mamdani.js";
import { LABELS, type Features } from "../../src/types.js";

const sample: Features = { S: 2, G: 0.15, L: 70, M: 20, netProfitUsd: 0, grossProfitUsd: 0, optTradeUsd: 0 };

/**
 * Odtwarza porządkowanie kluczy jsonb Postgresa (patrz mamdani.ts, komentarz przy
 * `outputTerms`: „jsonb Postgresa porządkuje klucze obiektu wg (długość, bajty)"). Round-trip
 * `AnfisModel` przez bazę może więc dostać obiekt z inną kolejnością kluczy niż ten, który
 * zapisał `toJSON()` — `fromJSON`/`anfisParamsSchema` muszą parsować po nazwach kluczy, nie
 * po pozycji, więc odwrócenie kolejności (dowolna inna niż oryginalna) to wystarczający test.
 */
function reorderKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reorderKeysDeep);
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).reverse();
    const out: Record<string, unknown> = {};
    for (const [k, val] of entries) out[k] = reorderKeysDeep(val);
    return out;
  }
  return v;
}

describe("AnfisModel", () => {
  it("kind = 'anfis'", () => {
    expect(new AnfisModel(initFromMamdani()).kind).toBe("anfis");
  });

  it("score 0–100 z etykietą i szczegółami (16 sił odpalenia)", () => {
    const m = new AnfisModel(initFromMamdani());
    const r = m.score(sample);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.details.firing).toHaveLength(16);
    expect(LABELS).toContain(r.label);
  });

  it("etykieta = labelForScore(score) — spójna z MamdaniModel dla tego samego wyniku", () => {
    const m = new AnfisModel(initFromMamdani());
    const r = m.score(sample);
    expect(r.label).toBe(labelForScore(r.score));
  });

  it("toJSON/fromJSON: round-trip przez JSON.stringify/parse daje identyczny wynik", () => {
    const m = new AnfisModel(initFromMamdani());
    const json = JSON.parse(JSON.stringify(m.toJSON()));
    const back = AnfisModel.fromJSON(json);
    expect(back.score(sample)).toEqual(m.score(sample));
    expect(back.toJSON()).toEqual(m.toJSON());
  });

  it("round-trip odporny na przestawienie kluczy obiektów (symulacja jsonb Postgresa)", () => {
    const m = new AnfisModel(initFromMamdani());
    const reordered = reorderKeysDeep(JSON.parse(JSON.stringify(m.toJSON())));
    const back = AnfisModel.fromJSON(reordered);
    expect(back.score(sample)).toEqual(m.score(sample));
  });

  it("fromJSON/konstruktor odrzuca zły kształt (wersja, długość konsekwentu, brak pól)", () => {
    expect(() => AnfisModel.fromJSON({ version: 2 })).toThrow();
    expect(() => new AnfisModel(undefined)).toThrow();
    expect(() => new AnfisModel({})).toThrow();
    const badConsequent = { ...initFromMamdani(), consequents: [[1]] };
    expect(() => AnfisModel.fromJSON(badConsequent)).toThrow();
    const badClauseRange = {
      ...initFromMamdani(),
      rules: [{ id: "X", clauses: [{ varIdx: 0, termIdx: 99, negate: false }], then: "wykonalna" }],
      consequents: [[0, 0, 0, 0, 0]],
    };
    expect(() => AnfisModel.fromJSON(badClauseRange)).toThrow();
  });
});
