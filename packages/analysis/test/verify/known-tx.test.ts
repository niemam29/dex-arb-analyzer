// Test integracyjny na ZNANEJ, prawdziwej tx z maja 2021 — RPC-gated:
// uruchamiany TYLKO gdy `RUN_LIVE_RPC=1` (wymaga sieci i archiwalnego RPC_URL w .env), inaczej
// pomijany (`describe.skipIf`). Weryfikuje cały łańcuch produkcyjny (pickCandidate -> fetchReceipts
// -> classify) na rzeczywistych danych: swapy z bazy deweloperskiej (`DATABASE_URL`, para 1
// WETH/USDC, okno 2 — krach maj 2021) + prawdziwy receipt z RPC.
//
// Kandydat: pierwsza (chronologicznie) tx ze Swapem w OBU pulach pary 1/okna 2, znaleziona
// zapytaniem do `swap_events` — blok 12429896, 1418 takich tx w oknie. Potwierdzona
// ręcznie na Etherscan (https://etherscan.io/tx/0x4b29b981...3bf80): tx udana, MEV bot
// (kontrakt 0x3700006fBCDE59a8B3AF2C134d00e9530000e379, "MEV Bot: 0x370...379" — DOKŁADNIE
// `receipt.to`, tx wywołana wprost na ten kontrakt) sprzedaje 302.089809386583157800 WETH na
// Uniswap V2 (USDC przekazane bezpośrednio do puli Sushiswap — bot nigdy nie odbiera USDC),
// Sushiswap zwraca 305.860568765148026136 WETH botowi — zysk brutto netto WETH dla bota =
// 3.770759378564868336 WETH (~$14 180 wg Etherscan), gasUsed=145 877, gasPrice=88 gwei.
// `from` tx (inicjator) to 0x0f424034FA825bcfaF22b2ff0ecA53DE4915b74B — RÓŻNY od kontraktu bota
// (`receipt.to`), więc jest to dokładnie wzorzec "bot contract keeps profit" (ADR 0005).
//
// Ta tx jest NIEZALEŻNA od `getBlockUniqueOpportunity`/`opportunities` — testujemy detekcję
// atomowego arbitrażu i klasyfikację bezpośrednio na surowych swapach z bloku, nie na
// konkretnej okazji zapisanej w tabeli `opportunities` (okazja w tym bloku może, ale nie musi,
// istnieć — nie jest tu potrzebna).
//
// Uruchomienie: RUN_LIVE_RPC=1 npx vitest run packages/analysis/test/verify/known-tx.test.ts
// (czyta DATABASE_URL/RPC_URL/RPC_FALLBACK_URLS z .env przez tsx --env-file, tak jak inne testy).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@dex-arb/db";
import { loadIngestEnv, RpcClient } from "@dex-arb/ingest";
import { SPREAD_THRESHOLD_PCT } from "@dex-arb/shared";
import { classify, K_MAX, pickCandidate } from "../../src/verify/classify.js";
import type { ClassifyInput } from "../../src/verify/classify.js";
import { createDrizzleVerifyRepo } from "../../src/verify/verify-job.js";
import { fetchReceipts, parseReceipt } from "../../src/verify/receipt.js";
import { pickBeneficiary, tokenNetFlow } from "../../src/verify/profit.js";
import { classifyRoute } from "../../src/verify/route.js";
import type { Receipt } from "../../src/verify/types.js";
import { PAIR, SUSHI, UNI, USDC, WETH } from "./fixtures.js";
import { hasReceiptFixture, loadReceiptFixture } from "../fixtures/receipts/index.js";

const POOLS = [UNI, SUSHI];

const PAIR_ID = 1; // WETH/USDC
const TX = "0x4b29b981025a2686cf666cbaac8a7ba001a15588f071f482d98d615cc063bf80";
const BLOCK = 12429896;
// Kontrakt bota MEV wywołany wprost przez tę tx (`receipt.to`, potwierdzone na Etherscan —
// patrz komentarz modułu). Netto WETH dla tego adresu (Etherscan): 305.860568765148026136 −
// 302.089809386583157800 = 3.770759378564868336 WETH.
const BOT_CONTRACT = "0x3700006fbcde59a8b3af2c134d00e9530000e379";

describe.skipIf(!process.env.RUN_LIVE_RPC)("known atomic tx (May 2021, live RPC + dev DB)", () => {
  let db: Db;
  let closeDb: () => Promise<void>;

  beforeAll(() => {
    const conn = createDb(); // DATABASE_URL — baza dev (SELECT-y wyłącznie, bez zapisów)
    db = conn.db;
    closeDb = () => conn.sql.end();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("pickCandidate + fetchReceipts + classify zgadzają się z Etherscan i dają consumed_atomic z policzalnym zyskiem", async () => {
    const repo = createDrizzleVerifyRepo(db);
    const { ctx } = await repo.loadPairContext(PAIR_ID);
    const poolIds = ctx.pools.map((p) => p.id);

    const swaps = await repo.loadSwaps(poolIds, BLOCK, BLOCK + K_MAX);
    expect(swaps.some((s) => s.txHash.toLowerCase() === TX)).toBe(true);

    const spreads = await repo.loadSpreads(PAIR_ID, BLOCK, BLOCK + K_MAX);
    const ref = spreads.get(BLOCK);
    expect(ref).toBeDefined();
    const ethUsd = (ref!.priceA + ref!.priceB) / 2;

    const input: ClassifyInput = {
      opp: { id: 0, block: BLOCK, spreadPct: ref!.spreadPct, expensivePoolId: poolIds[0]! },
      swaps,
      spreadAt: (b) => spreads.get(b)?.spreadPct ?? Number.POSITIVE_INFINITY,
      thresholdPct: SPREAD_THRESHOLD_PCT,
      ctx,
    };

    // 1) pickCandidate znajduje dokładnie naszą tx (Swap w obu pulach, przeciwne kierunki).
    const candidate = pickCandidate(input);
    expect(candidate).not.toBeNull();
    expect(candidate!.txHash).toBe(TX);
    expect(candidate!.block).toBe(BLOCK);

    // 2) fetchReceipts (prawdziwy RPC): tx udana, przelewy ERC-20 obejmują USDC i WETH.
    const rpc = new RpcClient({ urls: loadIngestEnv().rpcUrls });
    const receipts = await fetchReceipts(rpc, [TX], 1);
    const receipt = receipts.get(TX);
    expect(receipt).toBeDefined();
    expect(receipt!.status).toBe(1);
    // gasUsed=145 877 potwierdzone na Etherscan (pole "Gas Used by Transaction").
    expect(receipt!.gasUsed).toBe(145_877n);
    const addrs = new Set(receipt!.transfers.map((t) => t.address));
    expect(addrs.has(USDC)).toBe(true);
    expect(addrs.has(WETH)).toBe(true);

    // 3) classify: kandydat + receipt udany -> consumed_atomic, zysk realny SKOŃCZONY (liczba).
    const result = classify(input, candidate, receipt!, { baseUsd: ethUsd, quoteUsd: 1 }, ethUsd);
    expect(result.status).toBe("consumed_atomic");
    expect(result.consumerTxHash).toBe(TX);
    expect(result.blocksToConsumption).toBe(0);
    expect(result.realizedProfitUsd).not.toBeNull();
    expect(Number.isFinite(result.realizedProfitUsd)).toBe(true);
    expect(result.gasUsed).toBe(145_877n);
    expect(result.gasCostUsd).not.toBeNull();
    expect(result.gasCostUsd!).toBeGreaterThan(0);

    // Przed ADR 0005 `candidate.
    // beneficiary` wychodził `null` (swapy tej tx mają RÓŻNE `to` między pulami — bot przekazuje
    // USDC bezpośrednio z Uniswap do puli Sushiswap zamiast przez siebie, częsty wzorzec MEV do
    // oszczędzania gazu), więc `classify` spadał na `receipt.from` (0x0f42...b74b — adres EOA
    // inicjującej tx), który nie ma żadnych przepływów tokenów pary -> `realizedProfitUsd`=0,
    // mimo realnego zysku. `pickBeneficiary` teraz przegląda też `receipt.to` (kontrakt
    // wywołany WPROST przez tę tx — potwierdzone na Etherscan: "Interacted With (To)" =
    // 0x3700006fBCDE59a8B3AF2C134d00e9530000e379, "MEV Bot: 0x370...379") i wybiera go, bo ma
    // maksymalne netto USD spośród kandydatów (jedyny adres z dodatnim netto WETH w logach
    // Transfer tej tx). Wzorzec: "bot contract keeps profit" (kontrakt wywołany = kontrakt,
    // który zatrzymuje zysk) -> `beneficiaryKind` = 'contract'.
    expect(result.beneficiary).toBe(BOT_CONTRACT);
    expect(result.beneficiaryKind).toBe("contract");
    // Netto WETH dla kontraktu bota wg Etherscan (Token Transfers, patrz komentarz modułu):
    // 305.860568765148026136 − 302.089809386583157800 = 3.770759378564868336 WETH. USDC nigdy
    // nie dotyka bota (przekazane bezpośrednio Uniswap -> Sushiswap), więc netQuote=0 i cały
    // zysk pochodzi z netBase*ethUsd — porównanie z niezależnie obliczoną wartością oczekiwaną
    // (nie tautologia: `ethUsd` to cena z bloku konsumpcji, `netWeth` to liczba z Etherscan,
    // dopiero `classify`/`pickBeneficiary` łączą je przez realny receipt z RPC).
    const netWeth = 3.770759378564868; // zaokrąglone do precyzji double (patrz komentarz wyżej)
    expect(result.realizedProfitUsd).toBeCloseTo(netWeth * ethUsd, 2);
    expect(result.realizedProfitUsd!).toBeGreaterThan(0);
    expect(result.profitableConsumed).toBe(true);
  }, 30_000);
});

// ADR 0004 (ETH i WETH jako JEDEN aktyw, noga natywna na `receipt.from`):
// trzy prawdziwe tx z pary 1/okna 2 (docs/verification-checklist.md), receipt pobierany na żywo
// przez `eth_getTransactionReceipt` (skip gdy brak `RPC_URL`; nie wymaga bazy). Wartości oczekiwane
// policzone NIEZALEŻNIE z logów WETH tych receiptów (Transfer/Deposit/Withdrawal, skrypt
// jednorazowy przed napisaniem testu) — tolerancja ±1%:
//  - 0x972cc34a… (opp 154): kontrakt 0x78a5… (receipt.to) Deposit 746,02126 -> Transfer 746,02126
//    do Uniswap -> Transfer 762,891026… z Sushiswap -> Withdrawal 762,891026…; kontrakt netto 0,
//    receipt.from 0x3ed2… netto +16,869766… WETH (przed fixem: 762,89 WETH ≈ 1,62 mln USD).
//  - 0x61af9018… (opp 25): bot 0xb958… (receipt.to) Deposit 166,543088… -> Uniswap; Sushiswap ->
//    router Sushi 0xd9e1… 167,044863… -> Withdrawal; receipt.from 0x94d6… netto +0,501774… WETH.
//  - 0x19ff166f… (opp 479): kontrakt 0x5b60… (receipt.to) Deposit 550,669357… -> Uniswap;
//    Sushiswap -> 561,304227…; Transfer 10,139266… do 0x1d5a… (adres spoza tx.from/to, nie miner
//    bloku 12480097 — 0x5a0b…); Withdrawal 551,164960…; kontrakt netto 0, receipt.from 0xb20a…
//    netto +0,495602… WETH; `pickBeneficiary` (maks. netto USD) wybiera 0x1d5a… (10,139 WETH,
//    kind 'other') — bot przekazał większość zysku osobnemu adresowi.
describe.skipIf(!process.env.RPC_URL)("fix A — ETH+WETH netting na prawdziwych receiptach (live RPC)", () => {
  const price = { baseUsd: 3000, quoteUsd: 1 };
  const ethUsd = 3000;
  const WEI = 1e18;
  const rpc = () => new RpcClient({ urls: loadIngestEnv().rpcUrls });
  const netWeth = (receipt: Receipt, addr: string) => Number(tokenNetFlow(receipt.transfers, WETH, addr)) / WEI;
  const within1pct = (actual: number, expected: number) => expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(0.01);

  it("0x972cc34a… (opp 154): kontrakt-wykonawca netto 0, receipt.from ≈ +16,87 WETH (762,89 − 746,02)", async () => {
    const TX2 = "0x972cc34a1aea5ec41a81c7d4e37afab3dc57566b2ee12a4a52b6a06f02dc924c";
    const receipt = (await fetchReceipts(rpc(), [TX2], 1)).get(TX2)!;
    expect(receipt.status).toBe(1);
    expect(receipt.nativeLeg).toBe(true);
    expect(receipt.to).toBe("0x78a55b9b3bbeffb36a43d9905f654d2769dc55e8");
    expect(receipt.from).toBe("0x3ed25afe78c891b778b39ad0a6a3f1e16830df30");
    expect(netWeth(receipt, receipt.to!)).toBe(0);
    within1pct(netWeth(receipt, receipt.from), 762.8910262317672 - 746.02126);
    const choice = pickBeneficiary([], receipt, PAIR, POOLS, price, ethUsd);
    expect(choice!.address).toBe(receipt.from);
    expect(choice!.kind).toBe("eoa");
    within1pct(choice!.profit.profitUsd, 16.86976623176717 * ethUsd);
  }, 30_000);

  it("0x61af9018… (opp 25): router netto 0, receipt.from ≈ +0,50 WETH", async () => {
    const TX2 = "0x61af9018b6afaf73202f82244ef5534bc7c177af79d8c74d8025aed1f71cf4c4";
    const receipt = (await fetchReceipts(rpc(), [TX2], 1)).get(TX2)!;
    expect(receipt.status).toBe(1);
    expect(receipt.from).toBe("0x94d6522c80fb261c147a4111ad9a49407042f9b4");
    expect(netWeth(receipt, "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f")).toBe(0); // router Sushi
    expect(netWeth(receipt, receipt.to!)).toBe(0);
    within1pct(netWeth(receipt, receipt.from), 0.5017747988144241);
    const choice = pickBeneficiary([], receipt, PAIR, POOLS, price, ethUsd);
    expect(choice!.address).toBe(receipt.from);
    within1pct(choice!.profit.profitUsd, 0.5017747988144241 * ethUsd);
  }, 30_000);

  it("0x19ff166f… (opp 479): kontrakt-wykonawca netto 0, receipt.from ≈ +0,50 WETH, 0x1d5a… ≈ +10,14 WETH", async () => {
    const TX2 = "0x19ff166f473136d19131ab846ced46b439c69e336be6aa3a82c1038439ea2840";
    const OTHER = "0x1d5a23e81a97b22c6946b48b7c383342eeadc17b";
    const receipt = (await fetchReceipts(rpc(), [TX2], 1)).get(TX2)!;
    expect(receipt.status).toBe(1);
    expect(receipt.to).toBe("0x5b609c6cbd5c1b06e1250806e695eb0ce5433f06");
    expect(receipt.from).toBe("0xb20a3b4d957f700742be663eb3261949a80f8eb2");
    expect(netWeth(receipt, receipt.to!)).toBe(0);
    within1pct(netWeth(receipt, receipt.from), 0.4956024221712594);
    within1pct(netWeth(receipt, OTHER), 10.139266700589687);
    const choice = pickBeneficiary([], receipt, PAIR, POOLS, price, ethUsd);
    expect(choice!.address).toBe(OTHER);
    expect(choice!.kind).toBe("other");
    within1pct(choice!.profit.profitUsd, 10.139266700589687 * ethUsd); // przed fixem: 551,16 WETH ≈ 1,16 mln USD
  }, 30_000);
});

const TXS = {
  bot: '0x4b29b981025a2686cf666cbaac8a7ba001a15588f071f482d98d615cc063bf80',
  roundTrip: '0x972cc34a1aea5ec41a81c7d4e37afab3dc57566b2ee12a4a52b6a06f02dc924c',
  kyber: '0x61af9018b6afaf73202f82244ef5534bc7c177af79d8c74d8025aed1f71cf4c4',
  forwarded: '0x19ff166f473136d19131ab846ced46b439c69e336be6aa3a82c1038439ea2840',
};
const ALL_FIXTURES = Object.values(TXS).every(hasReceiptFixture);

// Wariant OFFLINE tych samych dowodów (ADR 0004/0005): receipty nagrane `scripts/record-receipt.ts`.
describe.skipIf(!ALL_FIXTURES)('znane tx — receipty z fixtures (offline)', () => {
  const price = { baseUsd: 3000, quoteUsd: 1 };
  const ethUsd = 3000;
  const WEI = 1e18;
  const netWeth = (receipt: Receipt, addr: string) => Number(tokenNetFlow(receipt.transfers, WETH, addr)) / WEI;
  const within1pct = (actual: number, expected: number) => expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(0.01);

  it('0x4b29b981…: gasUsed 145 877, beneficjent = kontrakt bota (receipt.to), +3,770759 WETH', () => {
    const receipt = parseReceipt(loadReceiptFixture(TXS.bot));
    expect(receipt.status).toBe(1);
    expect(receipt.gasUsed).toBe(145_877n);
    expect(receipt.to).toBe(BOT_CONTRACT);
    within1pct(netWeth(receipt, BOT_CONTRACT), 3.770759378564868);
    const choice = pickBeneficiary([], receipt, PAIR, POOLS, price, ethUsd);
    expect(choice!.address).toBe(BOT_CONTRACT);
    expect(choice!.kind).toBe('contract');
  });
  it('0x972cc34a…: kontrakt netto 0, receipt.from ≈ +16,87 WETH, nativeLeg', () => {
    const receipt = parseReceipt(loadReceiptFixture(TXS.roundTrip));
    expect(receipt.nativeLeg).toBe(true);
    expect(netWeth(receipt, receipt.to!)).toBe(0);
    within1pct(netWeth(receipt, receipt.from), 762.8910262317672 - 746.02126);
    expect(pickBeneficiary([], receipt, PAIR, POOLS, price, ethUsd)!.address).toBe(receipt.from);
  });
  it('0x61af9018…: receipt.from ≈ +0,50 WETH; trasa multi (Kyber)', () => {
    const receipt = parseReceipt(loadReceiptFixture(TXS.kyber));
    within1pct(netWeth(receipt, receipt.from), 0.5017747988144241);
    expect(classifyRoute(receipt, PAIR, POOLS)).toBe('multi');
  });
  it('0x19ff166f…: 10,139 WETH do adresu trzeciego -> beneficjent kind other; trasa two_pool', () => {
    const receipt = parseReceipt(loadReceiptFixture(TXS.forwarded));
    const choice = pickBeneficiary([], receipt, PAIR, POOLS, price, ethUsd)!;
    expect(choice.address).toBe('0x1d5a23e81a97b22c6946b48b7c383342eeadc17b');
    expect(choice.kind).toBe('other');
    within1pct(choice.profit.profitUsd, 10.139266700589687 * ethUsd);
    expect(classifyRoute(receipt, PAIR, POOLS)).toBe('two_pool');
  });
});
