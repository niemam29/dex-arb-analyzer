// Test jednostkowy `classifyRoute` (ADR 0003): `two_pool` vs `multi` — uzasadnienie w
// nagłówku src/verify/route.ts.
import { describe, expect, it } from 'vitest';
import { classifyRoute, TOPIC_SWAP_V2, TOPIC_SWAP_V3 } from '../../src/verify/route';
import { CTX, PAIR, SUSHI_POOL_ADDR, UNI_POOL_ADDR, USDC } from './fixtures';
import type { Receipt } from '../../src/verify/types';

const BOT = '0xbot';
const THIRD_POOL_ADDR = '0x' + 'cc'.repeat(20);
const FOREIGN_TOKEN = '0x' + 'da1'.padStart(40, '0'); // "DAI"-ish, niezwiązany z parą WETH/USDC

const baseReceipt = (o: Partial<Receipt> = {}): Receipt => ({
  txHash: '0xaa',
  from: BOT,
  to: '0xrouter',
  gasUsed: 200_000n,
  effectiveGasPrice: 100n * 10n ** 9n,
  status: 1,
  transfers: [{ address: USDC, from: SUSHI_POOL_ADDR, to: BOT, value: 100_000000n }],
  logs: [
    { address: UNI_POOL_ADDR, topic0: TOPIC_SWAP_V2 },
    { address: SUSHI_POOL_ADDR, topic0: TOPIC_SWAP_V2 },
  ],
  ...o,
});

describe('classifyRoute', () => {
  it("clean two-pool: Swap V2 wyłącznie z dwóch puli pary, Transfer wyłącznie tokenów pary -> 'two_pool' (zachowanie NIEZMIENIONE)", () => {
    expect(classifyRoute(baseReceipt(), PAIR, CTX.pools)).toBe('two_pool');
  });

  it("brak pola `logs` (fixture ręczny, jak w classify.test.ts) -> spada tylko na warunek Transferów, nie fałszuje 'multi'", () => {
    const r: Receipt = { ...baseReceipt(), logs: undefined };
    expect(classifyRoute(r, PAIR, CTX.pools)).toBe('two_pool');
  });

  it("multi-pool: dodatkowy Swap V2 z TRZECIEJ puli (spoza pary) -> 'multi'", () => {
    const r = baseReceipt({
      logs: [
        { address: UNI_POOL_ADDR, topic0: TOPIC_SWAP_V2 },
        { address: SUSHI_POOL_ADDR, topic0: TOPIC_SWAP_V2 },
        { address: THIRD_POOL_ADDR, topic0: TOPIC_SWAP_V2 },
      ],
    });
    expect(classifyRoute(r, PAIR, CTX.pools)).toBe('multi');
  });

  it('obcy token Transfer (spoza pary) -> multi', () => {
    const r = baseReceipt({
      transfers: [
        { address: USDC, from: SUSHI_POOL_ADDR, to: BOT, value: 100_000000n },
        { address: FOREIGN_TOKEN, from: '0xdai_pool', to: BOT, value: 500n * 10n ** 18n },
      ],
    });
    expect(classifyRoute(r, PAIR, CTX.pools)).toBe('multi');
  });

  it('swap V3 (dowolny adres) -> multi', () => {
    const r = baseReceipt({
      logs: [
        { address: UNI_POOL_ADDR, topic0: TOPIC_SWAP_V2 },
        { address: SUSHI_POOL_ADDR, topic0: TOPIC_SWAP_V2 },
        { address: '0x' + 'ee'.repeat(20), topic0: TOPIC_SWAP_V3 },
      ],
    });
    expect(classifyRoute(r, PAIR, CTX.pools)).toBe('multi');
  });

  it('Transfer WETH (Withdrawal/Deposit rozliczony jako TransferLog na WETH_CONTRACT) jest DOZWOLONY, nawet gdy WETH nie jest tokenem quote/base tej pary', () => {
    // Odtwarza scenariusz: pula pary nie zawiera WETH, ale konsumująca tx wewnętrznie
    // wrap/unwrapuje WETH (syntetyczny TransferLog z decodeWethNativeTransfers) — to nie jest
    // "obcy token", tylko rozliczona osobno otoczka natywnego ETH.
    const WETH_CONTRACT = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    const r = baseReceipt({
      transfers: [
        { address: USDC, from: SUSHI_POOL_ADDR, to: BOT, value: 100_000000n },
        { address: WETH_CONTRACT, from: '0xrouter', to: BOT, value: 1n * 10n ** 18n },
      ],
    });
    expect(classifyRoute(r, PAIR, CTX.pools)).toBe('two_pool');
  });

  it('adresy puli są porównywane bez uwzględniania wielkości liter', () => {
    const r = baseReceipt({ logs: [{ address: UNI_POOL_ADDR.toUpperCase(), topic0: TOPIC_SWAP_V2 }] });
    expect(classifyRoute(r, PAIR, CTX.pools)).toBe('two_pool');
  });

  it('topic0 w mieszanej wielkości liter jest normalizowany (obcy Swap V2 z mixed-case topic0 -> multi)', () => {
    const mixed = TOPIC_SWAP_V2.slice(0, 10) + TOPIC_SWAP_V2.slice(10).toUpperCase();
    const r = baseReceipt({
      logs: [
        { address: UNI_POOL_ADDR, topic0: mixed },
        { address: THIRD_POOL_ADDR, topic0: mixed },
      ],
    });
    expect(classifyRoute(r, PAIR, CTX.pools)).toBe('multi');
  });

  it('Transfer tokena PARY (USDC) z obcego adresu spoza puli (np. depozyt bota z portfela) -> nadal two_pool', () => {
    const r = baseReceipt({
      transfers: [
        { address: USDC, from: '0x' + 'f0'.repeat(20), to: BOT, value: 100_000000n },
        { address: USDC, from: SUSHI_POOL_ADDR, to: BOT, value: 100_000000n },
      ],
    });
    expect(classifyRoute(r, PAIR, CTX.pools)).toBe('two_pool');
  });
});

// Odniesienie topic0 do stałej użytej gdzie indziej w kodzie (packages/ingest/test/decode.test.ts)
// — pilnuje, żeby TOPIC_SWAP_V2 tu i TOPIC_SWAP tam nie rozjechały się przy edycji.
describe('TOPIC_SWAP_V2', () => {
  it('zgadza się z topic0 Swap V2 używanym w @dex-arb/ingest', () => {
    expect(TOPIC_SWAP_V2).toBe('0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822');
  });
});
