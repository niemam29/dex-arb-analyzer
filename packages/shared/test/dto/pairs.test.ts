import { describe, it, expect } from "vitest";
import { PairDto, PoolDto } from "../../src/dto/pairs.js";

describe("PairDto", () => {
  it("parsuje parę z pulami", () => {
    const r = PairDto.safeParse({
      id: 1,
      symbol: "WETH/USDC",
      token_base: "0x0000000000000000000000000000000000000a",
      token_quote: "0x0000000000000000000000000000000000000b",
      pools: [
        { id: 1, dex_id: 1, dex_name: "uniswap-v2", address: "0x0000000000000000000000000000000000000c" },
      ],
    });
    expect(r.success).toBe(true);
  });
  it("odrzuca parę bez symbolu", () => {
    const r = PairDto.safeParse({ id: 1, token_base: "a", token_quote: "b", pools: [] });
    expect(r.success).toBe(false);
  });
});

describe("PoolDto", () => {
  it("odrzuca pulę z nienumerycznym id", () => {
    expect(PoolDto.safeParse({ id: "x", dex_id: 1, dex_name: "uniswap-v2", address: "0x0" }).success).toBe(
      false,
    );
  });
});
