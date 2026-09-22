// Test jednostkowy `pickBeneficiary` (ADR 0005): zastępuje
// heurystykę "wspólne `to` obu swapów, inaczej `receipt.from`" (detect.ts/classify.ts), która
// zaniżała `realized_profit_usd` do 0 dla ok. 62% `consumed_atomic` w oknie maj-2021 (patrz
// docs/verification-checklist.md).
//
// Trzy wzorce trasowania zysku botów MEV, każdy z ręcznie policzonym netto:
//   1) "direct EOA"          — arbitrażysta wykonuje oba swapy sam, zysk trafia bezpośrednio
//                               na jego EOA (który jest jednocześnie `tx.from`).
//   2) "bot contract keeps"  — EOA wywołuje WPROST kontrakt bota (`receipt.to` == kontrakt),
//                               bot odbiera token bazowy z drugiej puli i go zatrzymuje.
//   3) "bot forwards to EOA" — bot (wywołany wprost, `receipt.to` == bot) odbiera zysk, po czym
//                               PRZEKAZUJE go dalej na osobny adres (właściciela) Transferem —
//                               ani `receipt.to`, ani `receipt.from`, ani `to` żadnego ze swapów
//                               nie wskazuje na ten adres; jedynym sygnałem jest log Transfer.
import { describe, expect, it } from 'vitest';
import { pickBeneficiary } from '../../src/verify/profit';
import { PAIR, SUSHI_POOL_ADDR, UNI_POOL_ADDR, USDC, WETH } from './fixtures';
import type { PoolMeta, Receipt } from '../../src/verify/types';

const POOLS: PoolMeta[] = [
  { id: 1, address: UNI_POOL_ADDR, token0: USDC, token1: WETH, dexName: 'uniswap' },
  { id: 2, address: SUSHI_POOL_ADDR, token0: USDC, token1: WETH, dexName: 'sushiswap' },
];
const price = { baseUsd: 3000, quoteUsd: 1 };
const ethUsd = 3000;
const T = (address: string, from: string, to: string, value: bigint) => ({ address, from, to, value });
const weth = (n: number): bigint => BigInt(n) * 10n ** 18n; // n jest zawsze całkowite w tym pliku

const baseReceipt = (o: Partial<Receipt>): Receipt => ({
  txHash: '0xaa',
  from: '0xfrom',
  to: null,
  gasUsed: 200_000n,
  effectiveGasPrice: 100n * 10n ** 9n,
  status: 1,
  transfers: [],
  ...o,
});

describe('pickBeneficiary — trzy wzorce trasowania zysku', () => {
  it('"direct EOA": arbitrażysta wykonuje oba swapy sam, zysk trafia na jego EOA (tx.from)', () => {
    const EOA = '0xe0a1111111111111111111111111111111111a';
    const ROUTER = '0xd0e2222222222222222222222222222222222b'; // receipt.to, ale nie beneficjent
    const receipt = baseReceipt({
      from: EOA,
      to: ROUTER,
      transfers: [T(WETH, SUSHI_POOL_ADDR, EOA, weth(1))], // 1 WETH zysku wraca na EOA
    });
    const choice = pickBeneficiary([{ to: EOA }, { to: EOA }], receipt, PAIR, POOLS, price, ethUsd);
    expect(choice).not.toBeNull();
    expect(choice!.address).toBe(EOA);
    expect(choice!.kind).toBe('eoa');
    expect(choice!.profit.netBase).toBe(weth(1));
    expect(choice!.profit.profitUsd).toBeCloseTo(3000, 6); // 1 WETH * 3000 USD/WETH
  });

  it('"bot contract keeps profit": EOA wywołuje wprost kontrakt bota, bot zatrzymuje zysk', () => {
    const BOT = '0xb07111111111111111111111111111111111c1';
    const CALLER = '0xca11111111111111111111111111111111111d';
    const receipt = baseReceipt({
      from: CALLER, // inicjator różny od bota — stara heurystyka spadłaby tu na CALLER (profit 0)
      to: BOT, // tx wysłana wprost na kontrakt bota
      transfers: [T(WETH, SUSHI_POOL_ADDR, BOT, weth(2))], // bot odbiera 2 WETH i nic nie oddaje
    });
    // swapA.to = pula Sushi (bot przekazał token pośredni prosto do puli — wzorzec z realnej tx
    // z maja 2021, patrz known-tx.test.ts), swapB.to = bot (odbiera finalny output).
    const choice = pickBeneficiary([{ to: SUSHI_POOL_ADDR }, { to: BOT }], receipt, PAIR, POOLS, price, ethUsd);
    expect(choice!.address).toBe(BOT);
    expect(choice!.kind).toBe('contract');
    expect(choice!.profit.profitUsd).toBeCloseTo(6000, 6); // 2 WETH * 3000
  });

  it('"bot forwards to EOA": bot odbiera zysk i przekazuje go dalej na adres właściciela', () => {
    const BOT = '0xb07222222222222222222222222222222222c2';
    const TRIGGER = '0x7719999999999999999999999999999999999e'; // wyzwala bota, sam nic nie dostaje
    const OWNER = '0x0555555555555555555555555555555555550f'; // dostaje przekazany zysk — TYLKO przez log Transfer
    const receipt = baseReceipt({
      from: TRIGGER,
      to: BOT,
      transfers: [
        T(WETH, SUSHI_POOL_ADDR, BOT, weth(3)), // pula -> bot
        T(WETH, BOT, OWNER, weth(3)), // bot przekazuje CAŁOŚĆ dalej -> netto bota = 0
      ],
    });
    const choice = pickBeneficiary([{ to: SUSHI_POOL_ADDR }, { to: BOT }], receipt, PAIR, POOLS, price, ethUsd);
    expect(choice!.address).toBe(OWNER);
    expect(choice!.kind).toBe('other'); // OWNER nie jest ani `to` swapu, ani receipt.to/from
    expect(choice!.profit.profitUsd).toBeCloseTo(9000, 6); // 3 WETH * 3000
  });
});

describe('pickBeneficiary — adresy puli nigdy nie są wybierane', () => {
  it('pula wykluczona z kandydatów mimo najwyższego nominalnego netto', () => {
    const EOA = '0xe0a3333333333333333333333333333333333f';
    const receipt = baseReceipt({
      from: EOA,
      to: null,
      transfers: [
        T(WETH, '0xelsewhere00000000000000000000000000000', UNI_POOL_ADDR, weth(5)), // duży inflow do puli
        T(WETH, UNI_POOL_ADDR, EOA, weth(1)), // pula wypłaca 1 WETH EOA (mniej niż jej "netto")
      ],
    });
    // UNI_POOL_ADDR netto = +5 − 1 = +4 WETH (większe niż EOA=+1), ale to adres puli — nigdy
    // nie może zostać wybrany, niezależnie od wielkości przepływu.
    const choice = pickBeneficiary([{ to: UNI_POOL_ADDR }, { to: SUSHI_POOL_ADDR }], receipt, PAIR, POOLS, price, ethUsd);
    expect(choice!.address).toBe(EOA);
    expect(choice!.address).not.toBe(UNI_POOL_ADDR.toLowerCase());
    expect(choice!.profit.profitUsd).toBeCloseTo(3000, 6); // 1 WETH * 3000, nie 4*3000
  });

  it('zwraca null gdy jedynymi kandydatami są adresy puli', () => {
    const receipt = baseReceipt({ from: UNI_POOL_ADDR, to: SUSHI_POOL_ADDR, transfers: [] });
    const choice = pickBeneficiary([{ to: UNI_POOL_ADDR }, { to: SUSHI_POOL_ADDR }], receipt, PAIR, POOLS, price, ethUsd);
    expect(choice).toBeNull();
  });
});

describe('pickBeneficiary — remisy netto USD', () => {
  it('remis między kontraktem (receipt.to) a adresem "other" -> wygrywa receipt.to', () => {
    const CONTRACT = '0xc0071111111111111111111111111111111111';
    const OTHER = '0x0the2222222222222222222222222222222222';
    const FROM = '0xfr0333333333333333333333333333333333333'; // dostaje 0 — tylko dla pełności zbioru
    const receipt = baseReceipt({
      from: FROM,
      to: CONTRACT,
      transfers: [
        T(WETH, '0xsrc1000000000000000000000000000000000', CONTRACT, weth(1)),
        T(WETH, '0xsrc2000000000000000000000000000000000', OTHER, weth(1)), // identyczne netto
      ],
    });
    const choice = pickBeneficiary([], receipt, PAIR, POOLS, price, ethUsd);
    expect(choice!.profit.profitUsd).toBeCloseTo(3000, 6);
    expect(choice!.address).toBe(CONTRACT);
    expect(choice!.kind).toBe('contract');
  });

  it('remis między EOA (receipt.from, brak receipt.to) a adresem "other" -> wygrywa tx.from', () => {
    const FROM = '0xfr0444444444444444444444444444444444444';
    const OTHER = '0x0the5555555555555555555555555555555555';
    const receipt = baseReceipt({
      from: FROM,
      to: null, // brak kandydata "contract" w tym remisie
      transfers: [
        T(WETH, '0xsrc3000000000000000000000000000000000', FROM, weth(1)),
        T(WETH, '0xsrc4000000000000000000000000000000000', OTHER, weth(1)),
      ],
    });
    const choice = pickBeneficiary([], receipt, PAIR, POOLS, price, ethUsd);
    expect(choice!.profit.profitUsd).toBeCloseTo(3000, 6);
    expect(choice!.address).toBe(FROM);
    expect(choice!.kind).toBe('eoa');
  });
});
