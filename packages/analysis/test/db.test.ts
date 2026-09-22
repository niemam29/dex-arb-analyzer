// Mapowanie kierunku na granicy zapisu do bazy: core i
// BlockStateRow.direction używają "a->b"/"b->a"/"none", enum bazy direction_kind — "a_to_b"/
// "b_to_a"/"none". Test czysty, bez dostępu do bazy.
import { describe, expect, it } from "vitest";
import { toDbDirection } from "../src/db.js";

describe("toDbDirection", () => {
  it("mapuje strzałki core na wartości enuma direction_kind", () => {
    expect(toDbDirection("none")).toBe("none");
    expect(toDbDirection("a->b")).toBe("a_to_b");
    expect(toDbDirection("b->a")).toBe("b_to_a");
  });

  it("rzuca dla nieznanej wartości (nie zapisuje cicho wartości domyślnej)", () => {
    // @ts-expect-error celowo niepoprawna wartość spoza typu — sprawdzamy zabezpieczenie w runtime
    expect(() => toDbDirection("a_to_b")).toThrow(/nieznana wartość kierunku/);
  });
});
