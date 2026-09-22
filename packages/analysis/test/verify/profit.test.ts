import { describe, it, expect } from 'vitest';
import {
  decodeTransferLogs,
  decodeWethNativeTransfers,
  pickBeneficiary,
  realizedProfit,
  tokenNetFlow,
  WETH_CONTRACT,
  WETH_DEPOSIT_TOPIC,
  WETH_WITHDRAWAL_TOPIC,
} from '../../src/verify/profit';
import { PAIR, USDC, WETH } from './fixtures';
import type { Receipt } from '../../src/verify/types';

const BOT = '0x000000000000000000000000000000000000b0b0';
const T = (address: string, from: string, to: string, value: bigint) => ({ address, from, to, value });

describe('tokenNetFlow', () => {
  it('sums inflows minus outflows for beneficiary, case-insensitively', () => {
    const t = [T(USDC, '0xpool', BOT.toUpperCase(), 3020_000000n), T(USDC, BOT, '0xpool2', 3000_000000n), T(WETH, '0xpool', BOT, 1n)];
    expect(tokenNetFlow(t, USDC, BOT)).toBe(20_000000n);
    expect(tokenNetFlow(t, WETH, BOT)).toBe(1n);
  });
  it('ignores other tokens', () => {
    expect(tokenNetFlow([T('0xdai', '0xa', BOT, 5n)], USDC, BOT)).toBe(0n);
  });
});

describe('realizedProfit', () => {
  const receipt: Receipt = {
    txHash: '0xaa', from: BOT, to: '0xrouter', gasUsed: 200_000n, effectiveGasPrice: 100n * 10n ** 9n, status: 1,
    transfers: [
      T(USDC, BOT, '0xuni', 3000_000000n), T(WETH, '0xuni', BOT, 10n ** 18n),
      T(WETH, BOT, '0xsushi', 10n ** 18n), T(USDC, '0xsushi', BOT, 3020_000000n),
    ],
  };
  it('computes net flows in USD and gas cost', () => {
    const r = realizedProfit(receipt, BOT, PAIR, { baseUsd: 3000, quoteUsd: 1 }, 3000);
    expect(r.netBase).toBe(0n);
    expect(r.netQuote).toBe(20_000000n);
    expect(r.profitUsd).toBeCloseTo(20, 6);
    expect(r.gasCostUsd).toBeCloseTo(0.02 * 3000, 6); // 200k * 100 gwei = 0.02 ETH
  });
  it('values leftover base token at baseUsd', () => {
    const r = realizedProfit({ ...receipt, transfers: [T(WETH, '0xuni', BOT, 10n ** 17n)] }, BOT, PAIR, { baseUsd: 3000, quoteUsd: 1 }, 3000);
    expect(r.profitUsd).toBeCloseTo(300, 6);
  });
  it('can be negative', () => {
    const r = realizedProfit({ ...receipt, transfers: [T(USDC, BOT, '0xuni', 50_000000n)] }, BOT, PAIR, { baseUsd: 3000, quoteUsd: 1 }, 3000);
    expect(r.profitUsd).toBeCloseTo(-50, 6);
  });
});

// `decodeWethNativeTransfers` (ADR 0004): Withdrawal/Deposit WETH nie emitują
// logu Transfer (unwrap/wrap to zwykły `call` z natywną wartością), więc bez syntetycznych
// wpisów router, który odbiera WETH Transferem i sam go unwrapuje, wyglądałby jak beneficjent
// CAŁEJ kwoty — dokładnie wzorzec tx `0x61af9018…` (opp 25, docs/verification-checklist.md):
// router odbiera 167,04 WETH, unwrapuje WSZYSTKO, realny zysk bota ~0,5 WETH.
describe('decodeWethNativeTransfers', () => {
  const pad = (a: string) => '0x' + a.slice(2).padStart(64, '0');
  const hex = (v: bigint) => '0x' + v.toString(16).padStart(64, '0');
  const ROUTER = '0x' + 'a0'.repeat(20);
  const BOT_EOA = '0x' + 'b0'.repeat(20);
  const OTHER_CONTRACT = '0x' + 'c0'.repeat(20);
  const WAD = 167_040000000000000000n; // 167,04 WETH

  // ADR 0004: ETH i WETH = jeden aktyw, noga natywna ZAWSZE na receipt.from,
  // niezależnie od tego, czy src/dst == receipt.to.
  it('Withdrawal przez receipt.to -> −wad dla src, +wad natywnego ETH dla receipt.from (wzorzec 0x61af9018…/0x972cc34a…)', () => {
    const logs = [{ address: WETH_CONTRACT, topics: [WETH_WITHDRAWAL_TOPIC, pad(ROUTER)], data: hex(WAD) }];
    const r = decodeWethNativeTransfers(logs, BOT_EOA, ROUTER);
    expect(r.nativeLeg).toBe(true);
    expect(r.transfers).toEqual([{ address: WETH_CONTRACT, from: ROUTER, to: BOT_EOA, value: WAD }]);
  });

  it('Withdrawal przez kontrakt INNY niż receipt.to -> natywny ETH RÓWNIEŻ dla receipt.from (nie receipt.to)', () => {
    const logs = [{ address: WETH_CONTRACT, topics: [WETH_WITHDRAWAL_TOPIC, pad(OTHER_CONTRACT)], data: hex(WAD) }];
    const r = decodeWethNativeTransfers(logs, BOT_EOA, ROUTER);
    expect(r.nativeLeg).toBe(true);
    expect(r.transfers).toEqual([{ address: WETH_CONTRACT, from: OTHER_CONTRACT, to: BOT_EOA, value: WAD }]);
  });

  it('Withdrawal, brak receipt.to (np. tworzenie kontraktu) -> receipt.from', () => {
    const logs = [{ address: WETH_CONTRACT, topics: [WETH_WITHDRAWAL_TOPIC, pad(OTHER_CONTRACT)], data: hex(WAD) }];
    const r = decodeWethNativeTransfers(logs, BOT_EOA, null);
    expect(r.transfers).toEqual([{ address: WETH_CONTRACT, from: OTHER_CONTRACT, to: BOT_EOA, value: WAD }]);
  });

  it('Deposit przez receipt.to -> +wad dla dst, −wad dla receipt.from (EOA sfinansowało wrap, NIE samoprzelew)', () => {
    const logs = [{ address: WETH_CONTRACT, topics: [WETH_DEPOSIT_TOPIC, pad(ROUTER)], data: hex(WAD) }];
    const r = decodeWethNativeTransfers(logs, BOT_EOA, ROUTER);
    expect(r.nativeLeg).toBe(true);
    expect(r.transfers).toEqual([{ address: WETH_CONTRACT, from: BOT_EOA, to: ROUTER, value: WAD }]);
  });

  it('Deposit przez kontrakt INNY niż receipt.to -> odpływ z receipt.from', () => {
    const logs = [{ address: WETH_CONTRACT, topics: [WETH_DEPOSIT_TOPIC, pad(OTHER_CONTRACT)], data: hex(WAD) }];
    const r = decodeWethNativeTransfers(logs, BOT_EOA, ROUTER);
    expect(r.transfers).toEqual([{ address: WETH_CONTRACT, from: BOT_EOA, to: OTHER_CONTRACT, value: WAD }]);
  });

  it('self-funded round-trip (wzorzec 0x972cc34a…, opp 154): Deposit + Withdrawal na receipt.to -> kontrakt netto 0, receipt.from netto wynik − wsad', () => {
    const IN = 746_021260000000000000n; // 746,02126 WETH (wsad, Deposit)
    const OUT = 762_891026231767200000n; // 762,891026… WETH (wynik, Withdrawal)
    const logs = [
      { address: WETH_CONTRACT, topics: [WETH_DEPOSIT_TOPIC, pad(ROUTER)], data: hex(IN) },
      { address: WETH_CONTRACT, topics: [WETH_WITHDRAWAL_TOPIC, pad(ROUTER)], data: hex(OUT) },
    ];
    const r = decodeWethNativeTransfers(logs, BOT_EOA, ROUTER);
    // Rzeczywiste Transfery WETH tej tx: ROUTER -> pula (wsad), pula -> ROUTER (wynik).
    const POOL_A = '0x' + 'd1'.repeat(20);
    const POOL_B = '0x' + 'd2'.repeat(20);
    const all = [T(WETH, ROUTER, POOL_A, IN), T(WETH, POOL_B, ROUTER, OUT), ...r.transfers];
    expect(tokenNetFlow(all, WETH, ROUTER)).toBe(0n);
    expect(tokenNetFlow(all, WETH, BOT_EOA)).toBe(OUT - IN); // ≈ 16,87 WETH, NIE 762,89
  });

  it('pomija logi spoza WETH_CONTRACT nawet z pasującym topic0 (podrobiony event na innym kontrakcie)', () => {
    const logs = [{ address: USDC, topics: [WETH_WITHDRAWAL_TOPIC, pad(ROUTER)], data: hex(WAD) }];
    const r = decodeWethNativeTransfers(logs, BOT_EOA, ROUTER);
    expect(r.nativeLeg).toBe(false);
    expect(r.transfers).toEqual([]);
  });

  it('pomija zwykłe logi Transfer (3 topics) — Withdrawal/Deposit mają dokładnie 2', () => {
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const logs = [{ address: WETH_CONTRACT, topics: [TRANSFER_TOPIC, pad(ROUTER), pad(BOT_EOA)], data: hex(WAD) }];
    const r = decodeWethNativeTransfers(logs, BOT_EOA, ROUTER);
    expect(r.nativeLeg).toBe(false);
    expect(r.transfers).toEqual([]);
  });

  it('pure-ERC20 (brak Withdrawal/Deposit) -> nativeLeg=false, brak wpisów (regresja: nie zmienia istniejącego zachowania)', () => {
    const r = decodeWethNativeTransfers([], BOT_EOA, ROUTER);
    expect(r).toEqual({ transfers: [], nativeLeg: false });
  });
});

describe('pickBeneficiary — wzorzec 0x61af9018… (router odbiera WETH i unwrapuje dla bota)', () => {
  // Odtwarza opp 25 z docs/verification-checklist.md: router (receipt.to) dostaje 167,04 WETH
  // Transferem z puli, unwrapuje WSZYSTKO Withdrawal-em (bez fixu: router wygląda jak
  // beneficjent 167,04 WETH ≈ 500 tys. USD, anomalia). Bot (tx.from) wcześniej wysłał 166,54
  // WETH jako wsad pierwszej nogi arbitrażu (real Transfer bot -> pula). Po fixie: bot dostaje
  // syntetyczny natywny ETH (167,04) z Withdrawal, netto bota = 167,04 − 166,54 = 0,5 WETH.
  const ROUTER = '0x' + 'a0'.repeat(20);
  const BOT = '0x' + 'b0'.repeat(20);
  const POOL_OUT = '0x' + 'd1'.repeat(20); // pula, która wypłaca WETH routerowi (druga noga)
  const price = { baseUsd: 3000, quoteUsd: 1 };
  const ethUsd = 3000;
  const T = (address: string, from: string, to: string, value: bigint) => ({ address, from, to, value });

  it('beneficjent = bot/EOA (tx.from) z ~0,5 WETH zysku, NIE router (~167 WETH nominalnie)', () => {
    const native = decodeWethNativeTransfers(
      [{ address: WETH_CONTRACT, topics: [WETH_WITHDRAWAL_TOPIC, '0x' + ROUTER.slice(2).padStart(64, '0')], data: '0x' + 167_040000000000000000n.toString(16).padStart(64, '0') }],
      BOT,
      ROUTER,
    );
    const receipt: Receipt = {
      txHash: '0x61af9018',
      from: BOT,
      to: ROUTER,
      gasUsed: 675_171n,
      effectiveGasPrice: 50n * 10n ** 9n,
      status: 1,
      transfers: [
        T(WETH, BOT, POOL_OUT, 166_540000000000000000n), // bot -> pula (wsad pierwszej nogi)
        T(WETH, POOL_OUT, ROUTER, 167_040000000000000000n), // pula -> router (output drugiej nogi)
        ...native.transfers, // router unwrapuje -> syntetyczny natywny ETH dla BOT (tx.from)
      ],
      nativeLeg: native.nativeLeg,
    };
    expect(receipt.nativeLeg).toBe(true);

    const choice = pickBeneficiary([{ to: POOL_OUT }, { to: ROUTER }], receipt, PAIR, [], price, ethUsd);
    expect(choice).not.toBeNull();
    expect(choice!.address).toBe(BOT);
    expect(choice!.kind).toBe('eoa');
    // 167,04 (natywny ETH z unwrapu) − 166,54 (wsad WETH) = 0,5 WETH * 3000 USD/WETH = 1500 USD.
    expect(choice!.profit.netBase).toBe(500000000000000000n);
    expect(choice!.profit.profitUsd).toBeCloseTo(1500, 6);

    // Router (receipt.to): +167,04 (Transfer z puli) − 167,04 (Withdrawal unwrap) = netto 0 —
    // bez fixu router "kończył" z 167,04 WETH nominalnie (anomalia opp 25 w checkliście).
    const routerProfit = realizedProfit(receipt, ROUTER, PAIR, price, ethUsd);
    expect(routerProfit.netBase).toBe(0n);
  });
});

describe('decodeTransferLogs', () => {
  const TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const pad = (a: string) => '0x' + a.slice(2).padStart(64, '0');
  it('decodes Transfer logs and skips others', () => {
    const logs = [
      { address: USDC, topics: [TOPIC, pad('0xaa'), pad('0xbb')], data: '0x' + (1000n).toString(16).padStart(64, '0') },
      { address: USDC, topics: ['0xdeadbeef'], data: '0x' },
      { address: USDC, topics: [TOPIC, pad('0xaa')], data: '0x' }, // ERC-721-like, brak `to` → pomiń
    ];
    const t = decodeTransferLogs(logs);
    expect(t).toHaveLength(1);
    expect(t[0]).toEqual({ address: USDC, from: '0x' + 'aa'.padStart(40, '0'), to: '0x' + 'bb'.padStart(40, '0'), value: 1000n });
  });
});
