import { describe, expect, it } from "vitest";
import { ARB_GAS, CONSTANT_TABLE, G_MAX, K_MAX, L_MAX, REF_TRADE_USD, SCORE_THRESHOLD, SPREAD_THRESHOLD_PCT, S_MAX } from "../src/constants.js";
import { ARB_GAS as FEATURES_ARB_GAS, S_MAX as FEATURES_S_MAX } from "../src/features.js";

describe("core/constants", () => {
  it("wartości metodyki bez zmian względem features.ts (reeksport, nie duplikat)", () => {
    expect(ARB_GAS).toBe(220_000);
    expect(REF_TRADE_USD).toBe(50_000);
    expect([S_MAX, G_MAX, L_MAX]).toEqual([3, 2, 100]);
    expect(K_MAX).toBe(3);
    expect(SPREAD_THRESHOLD_PCT).toBe(0.65);
    expect(SCORE_THRESHOLD).toBe(50);
    expect(FEATURES_ARB_GAS).toBe(ARB_GAS);
    expect(FEATURES_S_MAX).toBe(S_MAX);
  });
  it("CONSTANT_TABLE opisuje każdą stałą raz, z jednostką i uzasadnieniem", () => {
    const names = CONSTANT_TABLE.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(["ARB_GAS", "REF_TRADE_USD", "S_MAX", "G_MAX", "L_MAX", "K_MAX", "SPREAD_THRESHOLD_PCT", "SCORE_THRESHOLD", "LIVE_PRIORITY_GWEI"]));
    for (const c of CONSTANT_TABLE) {
      expect(c.unit.length).toBeGreaterThan(0);
      expect(c.rationale.length).toBeGreaterThan(20);
    }
    expect(CONSTANT_TABLE.find((c) => c.name === "ARB_GAS")!.value).toBe(ARB_GAS);
  });
});
