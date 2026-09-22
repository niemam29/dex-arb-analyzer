import { describe, it, expect } from "vitest";
import { CoverageResponse, CoverageCellDto } from "../../src/dto/coverage.js";

describe("CoverageResponse", () => {
  it("parsuje listę komórek pokrycia", () => {
    const r = CoverageResponse.safeParse([
      {
        pair_id: 1,
        window_id: 1,
        window_has_blocks: true,
        pools: [
          {
            pool_id: 1,
            dex_name: "uniswap-v2",
            done_blocks: 100,
            failed_blocks: 0,
            pending_blocks: 0,
            total_blocks: 100,
            coverage_pct: 100,
          },
        ],
        block_states: 100,
        states_min_block: 1,
        states_max_block: 100,
        scored_models: 2,
      },
    ]);
    expect(r.success).toBe(true);
  });
  it("odrzuca komórkę bez pools", () => {
    const r = CoverageCellDto.safeParse({
      pair_id: 1,
      window_id: 1,
      window_has_blocks: true,
      block_states: 0,
      states_min_block: null,
      states_max_block: null,
      scored_models: 0,
    });
    expect(r.success).toBe(false);
  });
  it("okno bez wyznaczonych bloków: coverage_pct i states_min/max_block mogą być null", () => {
    const r = CoverageCellDto.safeParse({
      pair_id: 1,
      window_id: 2,
      window_has_blocks: false,
      pools: [
        {
          pool_id: 1,
          dex_name: "uniswap-v2",
          done_blocks: 0,
          failed_blocks: 0,
          pending_blocks: 0,
          total_blocks: 0,
          coverage_pct: null,
        },
      ],
      block_states: 0,
      states_min_block: null,
      states_max_block: null,
      scored_models: 0,
    });
    expect(r.success).toBe(true);
  });
});
