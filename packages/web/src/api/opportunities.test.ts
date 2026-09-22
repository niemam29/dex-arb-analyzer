import { describe, it, expect } from "vitest";
import { opportunitiesUrl } from "./opportunities";

describe("opportunitiesUrl", () => {
  it("bez filtrów zwraca samą ścieżkę pary×okna", () => {
    expect(opportunitiesUrl(1, 2, {})).toBe("/pairs/1/windows/2/opportunities");
  });

  it("dokłada status/min_spread/model/page/page_size jako snake_case query", () => {
    const url = opportunitiesUrl(1, 2, {
      status: "consumed_atomic",
      min_spread: 0.65,
      model: "mamdani",
      page: 2,
      page_size: 25,
    });
    expect(url).toBe(
      "/pairs/1/windows/2/opportunities?status=consumed_atomic&min_spread=0.65&model=mamdani&page=2&page_size=25",
    );
  });

  it("status=unverified to prawidłowa wartość filtra (literał spoza VERIFICATION_STATUSES)", () => {
    expect(opportunitiesUrl(1, 2, { status: "unverified" })).toBe(
      "/pairs/1/windows/2/opportunities?status=unverified",
    );
  });

  it("pomija zera i puste stringi tam, gdzie oznaczają brak filtra", () => {
    expect(opportunitiesUrl(1, 2, { model: "", min_spread: 0 })).toBe(
      "/pairs/1/windows/2/opportunities?min_spread=0",
    );
  });
});
