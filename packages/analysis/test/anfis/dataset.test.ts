// Test części czystej `buildDataset`/`filterK0`/`computeGroupKeys` (ADR 0007) — bez bazy.
import { describe, expect, it } from "vitest";
import { BLOCK_CLUSTER_GAP_MAX, buildDataset, computeGroupKeys, filterK0, toFeatures, type LabeledRow } from "../../src/anfis/dataset.js";

const row = (block: number, o: Partial<LabeledRow> = {}): LabeledRow => ({
  pairId: 1,
  windowId: 1,
  block,
  s: 0.1,
  g: 0.2,
  l: 30,
  m: 40,
  netProfitUsd: 0,
  grossProfitUsd: 0,
  optTradeUsd: 0,
  isOpportunity: false,
  verified: true,
  label: 0,
  estProfitUsd: null,
  consumerTxHash: null,
  blocksToConsumption: null,
  gasCostUsd: null,
  ...o,
});

describe("buildDataset", () => {
  it("zostawia zweryfikowane okazje w całości (pozytywy i negatywy), pomija niezweryfikowane, podpróbkowuje tło 10:1 względem pozytywów", () => {
    const rows = [
      ...Array.from({ length: 1000 }, (_, i) => row(i)), // tło
      ...Array.from({ length: 3 }, (_, i) => row(5000 + i, { isOpportunity: true, s: 1.5, label: 1 })), // 3 pozytywy
      ...Array.from({ length: 7 }, (_, i) => row(6000 + i, { isOpportunity: true, s: 1.5, label: 0 })), // 7 negatywów (zweryfikowanych)
      row(9000, { isOpportunity: true, verified: false, s: 2 }), // okazja bez weryfikacji -> pominięta
    ];
    const d = buildDataset(rows, { negativesPerPositive: 5, seed: 1 });

    expect(d.meta.nPos).toBe(3);
    expect(d.meta.nNeg).toBe(7); // negatywy zweryfikowane NIE są podpróbkowywane
    expect(d.meta.nBackground).toBe(15); // 5 × 3 pozytywy
    expect(d.meta.windows).toEqual([1]);

    // total = nPos + nNeg + nBackground
    expect(d.X).toHaveLength(3 + 7 + 15);
    expect(d.y).toHaveLength(3 + 7 + 15);
    expect(d.y.filter((v) => v === 1)).toHaveLength(3);
    expect(d.X[0]).toHaveLength(4); // [S,G,L,M]
    // d.groups: klucze grupowe wyrównane 1:1 z X/y (do trainAnfis opts.groups). Pozytywy (bloki
    // 5000-5002, bez consumerTxHash, przerwy <= BLOCK_CLUSTER_GAP_MAX) tworzą JEDEN klaster;
    // negatywy (bloki 6000-6006, analogicznie) tworzą DRUGI klaster; tło to 15 singletonów (bg) —
    // razem 17 unikalnych grup.
    expect(d.groups).toHaveLength(d.X.length);
    expect(new Set(d.groups).size).toBe(1 + 1 + 15);
  });

  it("brak pozytywów -> tło podpróbkowane do 0 wierszy (10:1 względem 0)", () => {
    const rows = [...Array.from({ length: 50 }, (_, i) => row(i)), row(999, { isOpportunity: true, label: 0 })];
    const d = buildDataset(rows, { seed: 1 });
    expect(d.meta.nPos).toBe(0);
    expect(d.meta.nBackground).toBe(0);
    expect(d.meta.nNeg).toBe(1);
    expect(d.X).toHaveLength(1);
  });

  it("deterministyczne dla danego seeda (te same wejście+seed -> identyczny wynik)", () => {
    const rows = [
      ...Array.from({ length: 200 }, (_, i) => row(i)),
      ...Array.from({ length: 4 }, (_, i) => row(1000 + i, { isOpportunity: true, label: (i % 2) as 0 | 1 })),
    ];
    expect(buildDataset(rows, { seed: 7 })).toEqual(buildDataset(rows, { seed: 7 }));
  });

  it("różny seed może dać inny wybór wierszy tła (nie identyczny X)", () => {
    const rows = [
      ...Array.from({ length: 500 }, (_, i) => row(i, { s: i })), // wartości różne per wiersz
      ...Array.from({ length: 5 }, (_, i) => row(2000 + i, { isOpportunity: true, label: 1 })),
    ];
    const a = buildDataset(rows, { seed: 1, negativesPerPositive: 10 });
    const b = buildDataset(rows, { seed: 2, negativesPerPositive: 10 });
    expect(a.X).not.toEqual(b.X);
  });

  it("agreguje okna z wielu windowId (meta.windows posortowane, unikalne)", () => {
    const rows = [row(1, { windowId: 3 }), row(2, { windowId: 1 }), row(3, { windowId: 3 }), row(4, { windowId: 2 })];
    expect(buildDataset(rows).meta.windows).toEqual([1, 2, 3]);
  });

  // Trasa 'multi' (kolumna `route`, classifyRoute w ../verify/route.ts) ma nieznaną prawdziwą
  // etykietę i musi być pominięta, nie liczona jako negatyw mimo label=0.
  describe("pomijanie wierszy z route='multi' (nieznana etykieta)", () => {
    it("wiersz route='multi' jest pomijany (nie liczy się do nPos/nNeg) i zliczony w nSkippedUnknown", () => {
      const rows = [
        row(1, { isOpportunity: true, label: 1, status: "consumed_atomic", route: "two_pool", realizedProfitUsd: 50 }), // pozytyw znany
        row(2, { isOpportunity: true, label: 0, status: "consumed_atomic", route: "multi", realizedProfitUsd: null }), // nieznana etykieta -> pominięty
        row(3, { isOpportunity: true, label: 0, status: "consumed_atomic", route: "multi", realizedProfitUsd: null }), // nieznana etykieta -> pominięty
        row(4), // tło
      ];
      const d = buildDataset(rows, { negativesPerPositive: 10, seed: 1 });
      expect(d.meta.nPos).toBe(1);
      expect(d.meta.nNeg).toBe(0);
      expect(d.meta.nSkippedUnknown).toBe(2);
      expect(d.X).toHaveLength(2); // pozytyw (blok 1) + tło (blok 4) — bloki 2,3 pominięte
    });

    it("route='two_pool' NIE jest pomijany, nawet gdy label=0", () => {
      const rows = [row(1, { isOpportunity: true, label: 0, status: "consumed_atomic", route: "two_pool", realizedProfitUsd: -10 })];
      const d = buildDataset(rows);
      expect(d.meta.nNeg).toBe(1);
      expect(d.meta.nSkippedUnknown).toBe(0);
    });

    it("realizedProfitUsd=null bez route='multi' (np. decayed, route=null) NIE jest traktowany jako nieznana etykieta — decyduje wyłącznie `route`", () => {
      const rows = [row(1, { isOpportunity: true, label: 0, status: "decayed", route: null, realizedProfitUsd: null })];
      const d = buildDataset(rows);
      expect(d.meta.nNeg).toBe(1);
      expect(d.meta.nSkippedUnknown).toBe(0);
    });

    it("brak route (pole nieustawione, jak w starszych fixture'ach) domyślnie NIE jest traktowany jako nieznana etykieta", () => {
      const rows = [row(1, { isOpportunity: true, label: 1 })];
      const d = buildDataset(rows);
      expect(d.meta.nPos).toBe(1);
      expect(d.meta.nSkippedUnknown).toBe(0);
    });
  });
});

describe("toFeatures", () => {
  it("mapuje LabeledRow na Features (S,G,L,M,netProfitUsd,optTradeUsd)", () => {
    const r = row(1, { s: 0.9, g: 0.2, l: 50, m: 10, netProfitUsd: 12.5, grossProfitUsd: 20, optTradeUsd: 3000 });
    expect(toFeatures(r)).toEqual({ S: 0.9, G: 0.2, L: 50, M: 10, netProfitUsd: 12.5, grossProfitUsd: 20, optTradeUsd: 3000 });
  });
});

describe("filterK0", () => {
  it("odrzuca zweryfikowane okazje z blocksToConsumption=0, zostawia resztę (tło, niezweryfikowane, k>0)", () => {
    const rows = [
      row(1, { isOpportunity: true, verified: true, blocksToConsumption: 0, label: 1 }), // odrzucony
      row(2, { isOpportunity: true, verified: true, blocksToConsumption: 3, label: 1 }), // zostaje (k>0)
      row(3, { isOpportunity: true, verified: false, blocksToConsumption: null, label: 0 }), // zostaje (niezweryfikowana)
      row(4), // tło — zostaje
    ];
    const filtered = filterK0(rows);
    expect(filtered.map((r) => r.block)).toEqual([2, 3, 4]);
  });
});

describe("computeGroupKeys (ADR 0007)", () => {
  it("okazje z tym samym consumerTxHash dostają tę samą grupę, niezależnie od odległości bloków", () => {
    const rows = [
      row(1, { isOpportunity: true, verified: true, consumerTxHash: "0xabc" }),
      row(50, { isOpportunity: true, verified: true, consumerTxHash: "0xabc" }),
      row(2, { isOpportunity: true, verified: true, consumerTxHash: "0xdef" }),
    ];
    const keys = computeGroupKeys(rows);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).not.toBe(keys[2]);
  });

  it("okazje bez consumerTxHash tej samej pary klastrują się, gdy przerwa <= BLOCK_CLUSTER_GAP_MAX, inaczej rozdzielają", () => {
    const rows = [
      row(10, { isOpportunity: true, verified: true, consumerTxHash: null }),
      row(10 + BLOCK_CLUSTER_GAP_MAX, { isOpportunity: true, verified: true, consumerTxHash: null }), // ten sam klaster
      row(10 + BLOCK_CLUSTER_GAP_MAX + BLOCK_CLUSTER_GAP_MAX + 1, { isOpportunity: true, verified: true, consumerTxHash: null }), // nowy klaster
    ];
    const keys = computeGroupKeys(rows);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).not.toBe(keys[2]);
  });

  it("klastry są odrębne per para (ta sama sekwencja bloków, różne pairId)", () => {
    const rows = [
      row(10, { pairId: 1, isOpportunity: true, verified: true }),
      row(11, { pairId: 2, isOpportunity: true, verified: true }),
    ];
    const keys = computeGroupKeys(rows);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("klastry są odrębne per okno (przegląd T8/9, addendum): ta sama para i sekwencja bloków, różne windowId nie łączą się w jeden klaster", () => {
    const rows = [
      row(10, { pairId: 1, windowId: 1, isOpportunity: true, verified: true }),
      row(11, { pairId: 1, windowId: 2, isOpportunity: true, verified: true }), // przerwa bloków <= BLOCK_CLUSTER_GAP_MAX, ale INNE okno
    ];
    const keys = computeGroupKeys(rows);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("wiersze tła są singletonami (własna grupa per (pairId,block))", () => {
    const rows = [row(1), row(2)];
    const keys = computeGroupKeys(rows);
    expect(new Set(keys).size).toBe(2);
  });
});
