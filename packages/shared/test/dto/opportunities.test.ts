import { describe, it, expect } from "vitest";
import { OpportunityDetail, OpportunityList, OpportunityListQuery } from "../../src/dto/opportunities.js";

describe("OpportunityListQuery", () => {
  it("stosuje domyślne page/page_size", () => {
    const r = OpportunityListQuery.parse({});
    expect(r).toEqual({ page: 1, page_size: 50 });
  });
  it("akceptuje status weryfikacji albo 'unverified'", () => {
    expect(OpportunityListQuery.safeParse({ status: "consumed_atomic" }).success).toBe(true);
    expect(OpportunityListQuery.safeParse({ status: "unverified" }).success).toBe(true);
    expect(OpportunityListQuery.safeParse({ status: "bogus" }).success).toBe(false);
  });
  it("odrzuca page_size > 500", () => {
    expect(OpportunityListQuery.safeParse({ page_size: 501 }).success).toBe(false);
    expect(OpportunityListQuery.safeParse({ page_size: 500 }).success).toBe(true);
  });
  it("koerce z query stringów (min_spread, page, page_size jako string)", () => {
    const r = OpportunityListQuery.parse({ min_spread: "0.9", page: "2", page_size: "10" });
    expect(r).toEqual({ min_spread: 0.9, page: 2, page_size: 10 });
  });
});

describe("OpportunityList", () => {
  it("parsuje listę z weryfikacją i mapą scores", () => {
    const r = OpportunityList.safeParse({
      items: [
        {
          id: 1,
          block: 100,
          spread_pct: 1.0,
          direction: "a_to_b",
          est_profit_usd: 15,
          verification: {
            status: "consumed_atomic",
            consumer_tx_hash: "0xabc",
            realized_profit_usd: 20,
            gas_used: "200000",
            gas_cost_usd: 60,
            blocks_to_consumption: 1,
            profitable_consumed: false,
            route: "two_pool",
            verified_at: "2021-05-14T00:00:00.000Z",
          },
          scores: { mamdani: { score: 42.1, label: "wykonalna" } },
        },
        {
          id: 2,
          block: 200,
          spread_pct: 0.7,
          direction: "a_to_b",
          est_profit_usd: -5,
          verification: null,
          scores: { mamdani: null },
        },
      ],
      page: 1,
      page_size: 50,
      total: 2,
    });
    expect(r.success).toBe(true);
  });
});

describe("OpportunityDetail", () => {
  it("parsuje szczegóły z rezerwami, cechami block_states i aktywacjami reguł", () => {
    const r = OpportunityDetail.safeParse({
      id: 1,
      pair_id: 1,
      window_id: 1,
      block: 100,
      spread_pct: 1.0,
      direction: "a_to_b",
      est_profit_usd: 15,
      verification: null,
      scores: {},
      price_a: 3000,
      price_b: 3030,
      tvl_min_usd: 50e6,
      gas_price_median: 100e9,
      s: 1.0,
      g: 0.2,
      l: 50,
      m: 40,
      opt_trade_usd: 20000,
      baseline_net_profit_usd: 15,
      baseline_feasible: true,
      reserves: [
        { pool_id: 1, dex_name: "Uniswap V2", block: 99, reserve0: "150000000000000", reserve1: "50000000000000000000000" },
        { pool_id: 2, dex_name: "Sushiswap", block: 98, reserve0: "30300000000000", reserve1: "10000000000000000000000" },
      ],
      rule_activations: [{ id: "R1", strength: 0.8 }],
      etherscan_url: "https://etherscan.io/tx/0xabc",
    });
    expect(r.success).toBe(true);
  });
  it("odrzuca brak rule_activations", () => {
    const base = {
      id: 1, pair_id: 1, window_id: 1, block: 100, spread_pct: 1.0, direction: "a_to_b",
      est_profit_usd: null, verification: null, scores: {},
      price_a: 3000, price_b: 3030, tvl_min_usd: 50e6, gas_price_median: null,
      s: 1.0, g: 0.2, l: 50, m: 40, opt_trade_usd: null, baseline_net_profit_usd: null,
      baseline_feasible: null, reserves: [], etherscan_url: null,
    };
    expect(OpportunityDetail.safeParse(base).success).toBe(false);
  });
});
