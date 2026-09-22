import { describe, it, expect } from "vitest";
import { SeriesQuery, SeriesResponse } from "../../src/dto/series.js";

describe("SeriesQuery", () => {
  it("koercuje stringi z query", () => {
    expect(SeriesQuery.parse({ step: "50", from: "100", to: "200" })).toEqual({
      step: 50,
      from: 100,
      to: 200,
    });
  });
  it("odrzuca from > to", () => {
    expect(SeriesQuery.safeParse({ from: "5", to: "1" }).success).toBe(false);
  });
  it("odrzuca step 0", () => {
    expect(SeriesQuery.safeParse({ step: "0" }).success).toBe(false);
  });
  it("akceptuje pusty obiekt (wszystkie pola opcjonalne)", () => {
    expect(SeriesQuery.safeParse({}).success).toBe(true);
  });
});

describe("SeriesResponse", () => {
  it("parsuje odpowiedź z jednym punktem bez danych (kubełek bez zdarzeń)", () => {
    const r = SeriesResponse.safeParse({
      pair_id: 1,
      window_id: 1,
      step: 100,
      from_block: 0,
      to_block: 1000,
      threshold_pct: 0.65,
      models: [{ id: 1, name: "baseline-v1", kind: "baseline" }],
      points: [
        {
          from_block: 0,
          to_block: 99,
          ts: null,
          price_a: null,
          price_b: null,
          spread_avg: null,
          spread_min: null,
          spread_max: null,
          gas_median: null,
          scores: { "1": null },
        },
      ],
    });
    expect(r.success).toBe(true);
  });
  it("odrzuca punkt z odwróconym zakresem bloków brakującym polem", () => {
    const r = SeriesResponse.safeParse({
      pair_id: 1,
      window_id: 1,
      step: 100,
      from_block: 0,
      to_block: 1000,
      threshold_pct: 0.65,
      models: [],
      points: [{ from_block: 0 }],
    });
    expect(r.success).toBe(false);
  });
});
