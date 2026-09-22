// Test jednostkowy pobierania/parsowania receiptów tx. `fetchReceipts` (nie
// pojedynczy `fetchReceipt`) — batchujemy `eth_getTransactionReceipt` przez `RpcClient.batch`
// (paczki po 20, współbieżność) i cache'ujemy po hashu, bo ta sama tx bywa kandydatem dla kilku
// sąsiednich okazji. Brak receiptu (null) traktujemy jako
// błąd przejściowy (throw), żeby job skorzystał ze standardowego retry workera.
import { describe, expect, it, vi } from 'vitest';
import { fetchReceipts, parseReceipt } from '../../src/verify/receipt';
import type { RawReceipt, RpcLike, RpcRequest } from '../../src/verify/receipt';
import { USDC } from './fixtures';

const TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const raw = (hash: string): RawReceipt => ({
  transactionHash: hash,
  from: '0xB0B0',
  gasUsed: '0x30d40',
  effectiveGasPrice: '0x174876e800',
  status: '0x1',
  logs: [{ address: USDC, topics: [TOPIC, '0x' + 'a'.padStart(64, '0'), '0x' + 'b'.padStart(64, '0')], data: '0x' + (7n).toString(16).padStart(64, '0') }],
});

describe('parseReceipt', () => {
  it('parses hex fields to bigint and decodes transfers', () => {
    const r = parseReceipt(raw('0xaa'));
    expect(r).toMatchObject({ txHash: '0xaa', from: '0xb0b0', gasUsed: 200_000n, effectiveGasPrice: 100_000_000_000n, status: 1 });
    expect(r.transfers[0]!.value).toBe(7n);
  });

  it('falls back to gasPrice when effectiveGasPrice missing (pre-EIP-1559 nodes)', () => {
    const rest: RawReceipt = { ...raw('0xaa'), gasPrice: '0x1' };
    delete rest.effectiveGasPrice;
    expect(parseReceipt(rest).effectiveGasPrice).toBe(1n);
  });

  it('brak effectiveGasPrice i gasPrice -> błąd', () => {
    const rest: RawReceipt = raw('0xaa');
    delete rest.effectiveGasPrice;
    expect(() => parseReceipt(rest)).toThrow(/effectiveGasPrice/);
  });

  it('status "0x0" -> status 0', () => {
    expect(parseReceipt({ ...raw('0xaa'), status: '0x0' }).status).toBe(0);
  });

  // `to` (kontrakt wywołany) — kandydat na beneficjenta w `pickBeneficiary` (ADR 0005).
  it('lowercase-uje `to` gdy obecne', () => {
    expect(parseReceipt({ ...raw('0xaa'), to: '0xC0FFEE' }).to).toBe('0xc0ffee');
  });

  it('`to` brak (np. tworzenie kontraktu) -> null', () => {
    expect(parseReceipt(raw('0xaa')).to).toBeNull();
  });

  // Fix round po przeglądzie: Withdrawal/Deposit WETH dołączane jako syntetyczne Transfery
  // (`decodeWethNativeTransfers` w profit.ts), żeby unwrap bez logu Transfer nie gubił się przy
  // liczeniu netto beneficjenta — patrz `native-leg`/`0x61af9018…` w profit.test.ts.
  it('dołącza syntetyczne Transfery z Withdrawal WETH i ustawia nativeLeg=true', () => {
    const WETH_CONTRACT = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    const WITHDRAWAL_TOPIC = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65';
    // Adres w pełnej, 40-znakowej reprezentacji hex (tak jak odtwarza go `topicToAddr` z
    // topicu) — MUSI być identyczny z `to` (nie skrócona forma `0xc0ffee` z testu wyżej), bo
    // heurystyka porównuje `src === receipt.to`.
    const ROUTER = '0x' + 'c0ffee'.padStart(40, '0');
    const withRaw: RawReceipt = {
      ...raw('0xaa'),
      to: ROUTER,
      logs: [
        ...raw('0xaa').logs,
        { address: WETH_CONTRACT, topics: [WITHDRAWAL_TOPIC, '0x' + ROUTER.slice(2).padStart(64, '0')], data: '0x' + (5n).toString(16).padStart(64, '0') },
      ],
    };
    const r = parseReceipt(withRaw);
    expect(r.nativeLeg).toBe(true);
    // src (ROUTER) === receipt.to -> +wad dla receipt.from (`0xb0b0`), patrz heurystyka w profit.ts.
    expect(r.transfers).toContainEqual({ address: WETH_CONTRACT, from: ROUTER, to: '0xb0b0', value: 5n });
  });

  it('bez logów Withdrawal/Deposit -> nativeLeg=false, transfers niezmienione (regresja pure-ERC20)', () => {
    const r = parseReceipt(raw('0xaa'));
    expect(r.nativeLeg).toBe(false);
    expect(r.transfers).toHaveLength(1);
  });

  // ADR 0003: `logs` (adres + topic0, lowercase) — wejście `classifyRoute` (route.ts),
  // które musi widzieć WSZYSTKIE logi tx (nie tylko Transfer/Withdrawal/Deposit dekodowane do
  // `transfers`), żeby wykryć obcy Swap V2/V3.
  it('wypełnia `logs` adresem + topic0 (lowercase) dla każdego logu, niezależnie od jego typu', () => {
    const r = parseReceipt({ ...raw('0xaa'), to: '0xC0FFEE' });
    expect(r.logs).toEqual([{ address: USDC.toLowerCase(), topic0: TOPIC }]);
  });

  it('`logs` uwzględnia logi Withdrawal/Deposit WETH (te same, z których liczy się nativeLeg)', () => {
    const WETH_CONTRACT = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    const WITHDRAWAL_TOPIC = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65';
    const ROUTER = '0x' + 'c0ffee'.padStart(40, '0');
    const withRaw: RawReceipt = {
      ...raw('0xaa'),
      to: ROUTER,
      logs: [
        ...raw('0xaa').logs,
        { address: WETH_CONTRACT, topics: [WITHDRAWAL_TOPIC, '0x' + ROUTER.slice(2).padStart(64, '0')], data: '0x' + (5n).toString(16).padStart(64, '0') },
      ],
    };
    const r = parseReceipt(withRaw);
    expect(r.logs).toEqual([
      { address: USDC.toLowerCase(), topic0: TOPIC },
      { address: WETH_CONTRACT, topic0: WITHDRAWAL_TOPIC },
    ]);
  });
});

describe('fetchReceipts', () => {
  const rpcOf = (fn: (reqs: RpcRequest[]) => unknown[]): RpcLike => ({
    batch: vi.fn(async (reqs: RpcRequest[]) => fn(reqs)),
  });

  it('woła eth_getTransactionReceipt przez rpc.batch i zwraca sparsowane receipty w Map', async () => {
    const rpc = rpcOf((reqs) => reqs.map((r) => raw(r.params[0] as string)));
    const out = await fetchReceipts(rpc, ['0xaa', '0xbb'], 4);
    expect(rpc.batch).toHaveBeenCalledTimes(1);
    expect(rpc.batch).toHaveBeenCalledWith([
      { method: 'eth_getTransactionReceipt', params: ['0xaa'] },
      { method: 'eth_getTransactionReceipt', params: ['0xbb'] },
    ]);
    expect(out.get('0xaa')!.gasUsed).toBe(200_000n);
    expect(out.get('0xbb')!.gasUsed).toBe(200_000n);
  });

  it('dzieli na paczki po 20 hashy', async () => {
    const rpc = rpcOf((reqs) => reqs.map((r) => raw(r.params[0] as string)));
    const hashes = Array.from({ length: 25 }, (_, i) => `0x${i}`);
    const out = await fetchReceipts(rpc, hashes, 4);
    expect(rpc.batch).toHaveBeenCalledTimes(2);
    expect((rpc.batch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toHaveLength(20);
    expect((rpc.batch as ReturnType<typeof vi.fn>).mock.calls[1]![0]).toHaveLength(5);
    expect(out.size).toBe(25);
  });

  it('deduplikuje powtórzone hashe — jedno wywołanie na hash', async () => {
    const rpc = rpcOf((reqs) => reqs.map((r) => raw(r.params[0] as string)));
    await fetchReceipts(rpc, ['0xaa', '0xaa', '0xaa'], 4);
    expect((rpc.batch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toHaveLength(1);
  });

  it('receipt null (tx jeszcze niezindeksowana) -> rzuca błąd przejściowy', async () => {
    const rpc = rpcOf((reqs) => reqs.map(() => null));
    await expect(fetchReceipts(rpc, ['0xzz'], 4)).rejects.toThrow(/0xzz/);
  });
});
