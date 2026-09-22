// `jobsForAction` decyduje, jakie zadania kolejki wysłać dla danej akcji przycisku w tabeli
// pokrycia. Klucze params w camelCase (poolId/windowId/pairId) — zgodnie z `@dex-arb/shared`
// jobs.ts (jobParamsByType), nie ze snake_case reszty DTO API.
import { it, expect } from "vitest";
import type { PairDto, WindowDto } from "@dex-arb/shared";
import { jobsForAction } from "./jobActions";

const pair: PairDto = {
  id: 1,
  symbol: "WETH/USDC",
  token_base: "0x1",
  token_quote: "0x2",
  pools: [
    { id: 1, dex_id: 1, dex_name: "Uniswap V2", address: "0xa" },
    { id: 2, dex_id: 2, dex_name: "Sushiswap", address: "0xb" },
  ],
};
const win: WindowDto = { id: 3, name: "maj 2021", from_ts: "", to_ts: "", from_block: 1, to_block: 2 };

it("ingest → po jednym zadaniu na pulę", () => {
  expect(jobsForAction("ingest", pair, win)).toEqual([
    { type: "ingest:pool-window", params: { poolId: 1, windowId: 3 } },
    { type: "ingest:pool-window", params: { poolId: 2, windowId: 3 } },
  ]);
});

it("analyze/verify → jedno zadanie na parę", () => {
  expect(jobsForAction("analyze", pair, win)).toEqual([
    { type: "analyze:pair-window", params: { pairId: 1, windowId: 3 } },
  ]);
  // `force: true` zawsze — job jest idempotentny, więc
  // przycisk "Weryfikuj" ma reweryfikować nawet komórkę już w pełni zweryfikowaną, zamiast
  // cicho nic nie robić (patrz komentarz w jobActions.ts).
  expect(jobsForAction("verify", pair, win)).toEqual([
    { type: "verify:pair-window", params: { pairId: 1, windowId: 3, force: true } },
  ]);
});
