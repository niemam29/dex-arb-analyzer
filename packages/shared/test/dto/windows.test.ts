import { describe, it, expect } from "vitest";
import { WindowDto } from "../../src/dto/windows.js";

describe("WindowDto", () => {
  it("parsuje okno z null blokami (przed ingestem)", () => {
    const r = WindowDto.safeParse({
      id: 1,
      name: "maj-2021",
      from_ts: "2021-05-14T00:00:00.000Z",
      to_ts: "2021-05-26T23:59:59.000Z",
      from_block: null,
      to_block: null,
    });
    expect(r.success).toBe(true);
  });
  it("odrzuca okno bez nazwy", () => {
    const r = WindowDto.safeParse({ id: 1, from_ts: "x", to_ts: "y", from_block: null, to_block: null });
    expect(r.success).toBe(false);
  });
});
