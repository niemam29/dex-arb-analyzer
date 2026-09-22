// Test integracyjny wariantów populacji ewaluacji (`loadLabeledScores`, analiza wrażliwości):
// `full` = ADR 0008, `exclude_k0` = bez konsumpcji w bloku okazji, `bot_first` = tylko konsumpcje,
// w których tx bota była pierwszym swapem bloku B+k w pulach pary (i k ≥ 1). Warunek „bot pierwszy"
// jest w SQL, więc sprawdzany jest na bazie testowej: dwie okazje `two_pool` k=1 — jedna z obcym
// swapem PRZED tx bota w tym samym bloku, druga z obcym swapem dopiero PO — plus przypadki brzegowe
// (k=0, `multi`, negatyw dwupulowy, obcy swap w puli INNEJ pary).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { evaluateModelOnWindow, loadLabeledScores, type PopulationVariant, type ScoringModelRow } from "../src/queries/evaluation.sql.js";
import { HAS_DB, testDb, type SeedIds, type TestDb } from "./helpers/db.js";

let t: TestDb;
let ids: SeedIds;

const tx = (n: number): string => `0x${n.toString(16).padStart(64, "0")}`;

describe.skipIf(!HAS_DB)("loadLabeledScores: warianty populacji (DATABASE_URL_TEST)", () => {
  beforeAll(async () => {
    t = await testDb();
    await t.reset();
    ids = await t.seedCatalog();

    // Druga para (WETH/DAI) z własną pulą — obcy swap w JEJ puli nie może wpływać na „bot pierwszy" pary WETH/USDC.
    await t.db.execute(sql`INSERT INTO tokens (address, symbol, decimals) VALUES ('0x6B175474E89094C44Da98b954EedeAC495271d0F', 'DAI', 18)`);
    const [otherPair] = await t.db.execute<{ id: number }>(sql`
      INSERT INTO pairs (symbol, token_base, token_quote)
      VALUES ('WETH/DAI', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', '0x6B175474E89094C44Da98b954EedeAC495271d0F') RETURNING id`);
    const [otherPool] = await t.db.execute<{ id: number }>(sql`
      INSERT INTO pools (dex_id, pair_id, address, token0, token1)
      VALUES ((SELECT id FROM dexes WHERE name = 'Uniswap V2'), ${otherPair!.id}, '0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11',
              '0x6B175474E89094C44Da98b954EedeAC495271d0F', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2') RETURNING id`);

    // Okazje pary WETH/USDC (blok B) i ich weryfikacje; score modelu = 80 dla pozytywów, 20 dla negatywów.
    //  A  B=1000, two_pool, k=1, tx 1, zyskowna — w bloku 1001 OBCY swap (tx 9) PRZED swapami bota → bot NIE pierwszy
    //  B  B=1010, two_pool, k=1, tx 2, zyskowna — w bloku 1011 obcy swap (tx 8) dopiero PO swapach bota → bot pierwszy
    //  C  B=1020, two_pool, k=0, tx 3, zyskowna — bot pierwszy w bloku 1020, ale k=0
    //  D  B=1030, decayed, k=2 — negatyw, w każdym wariancie
    //  E  B=1040, multi, k=1, tx 5 — etykieta nieokreślona, w żadnym wariancie
    //  F  B=1050, two_pool, k=1, tx 6, NIEzyskowna, bot pierwszy — negatyw dwupulowy, zostaje w bot_first
    //  G  B=1060, two_pool, k=1, tx 7, zyskowna, bot pierwszy w pulach pary; obcy swap (tx 10) niżej, ale w puli INNEJ pary
    const opps: { block: number; status: string; route: string | null; k: number | null; txN: number | null; profitable: boolean }[] = [
      { block: 1000, status: "consumed_atomic", route: "two_pool", k: 1, txN: 1, profitable: true },
      { block: 1010, status: "consumed_atomic", route: "two_pool", k: 1, txN: 2, profitable: true },
      { block: 1020, status: "consumed_atomic", route: "two_pool", k: 0, txN: 3, profitable: true },
      { block: 1030, status: "decayed", route: null, k: 2, txN: null, profitable: false },
      { block: 1040, status: "consumed_atomic", route: "multi", k: 1, txN: 5, profitable: false },
      { block: 1050, status: "consumed_atomic", route: "two_pool", k: 1, txN: 6, profitable: false },
      { block: 1060, status: "consumed_atomic", route: "two_pool", k: 1, txN: 7, profitable: true },
    ];
    for (const o of opps) {
      const [row] = await t.db.execute<{ id: number }>(sql`
        INSERT INTO opportunities (pair_id, window_id, block, spread_pct, direction, est_profit_usd)
        VALUES (${ids.pairId}, ${ids.windowId}, ${o.block}, 1.0, 'a_to_b', 10) RETURNING id`);
      await t.db.execute(sql`
        INSERT INTO opportunity_verifications (opportunity_id, status, route, consumer_tx_hash, realized_profit_usd, gas_cost_usd, blocks_to_consumption, profitable_consumed)
        VALUES (${row!.id}, ${o.status}::verification_status, ${o.route}::verification_route, ${o.txN === null ? null : tx(o.txN)},
                ${o.route === "multi" ? null : o.profitable ? 100 : -5}, 10, ${o.k}, ${o.profitable})`);
      await t.db.execute(sql`
        INSERT INTO model_scores (model_id, pair_id, block, score, label)
        VALUES (${ids.modelId}, ${ids.pairId}, ${o.block}, ${o.profitable ? 80 : 20}, ${o.profitable ? "wykonalna" : "niewykonalna"}::feasibility_label)`);
    }

    // swap_events (pool_id, block, log_index, tx_hash) — log_index unikalny w bloku, jak w receipcie.
    const swaps: [number, number, number, string][] = [
      // blok 1001: obcy swap (tx 9) w puli A PRZED botem (tx 1: A@5, B@7)
      [ids.poolA, 1001, 3, tx(9)], [ids.poolA, 1001, 5, tx(1)], [ids.poolB, 1001, 7, tx(1)],
      // blok 1011: bot (tx 2: A@2, B@4) pierwszy, obcy swap (tx 8) w puli B PO
      [ids.poolA, 1011, 2, tx(2)], [ids.poolB, 1011, 4, tx(2)], [ids.poolB, 1011, 9, tx(8)],
      // blok 1020: bot (tx 3) pierwszy, ale to k=0
      [ids.poolA, 1020, 1, tx(3)], [ids.poolB, 1020, 2, tx(3)],
      // blok 1041: tx 5 (multi) — bez znaczenia dla wariantów
      [ids.poolA, 1041, 1, tx(5)], [ids.poolB, 1041, 2, tx(5)],
      // blok 1051: tx 6 pierwsza (negatyw dwupulowy)
      [ids.poolA, 1051, 0, tx(6)], [ids.poolB, 1051, 1, tx(6)],
      // blok 1061: obcy swap (tx 10) niżej, ale w puli INNEJ pary; w pulach pary bot (tx 7) pierwszy
      [otherPool!.id, 1061, 0, tx(10)], [ids.poolA, 1061, 4, tx(7)], [ids.poolB, 1061, 6, tx(7)],
    ];
    for (const [poolId, block, logIndex, txHash] of swaps) {
      await t.db.execute(sql`INSERT INTO swap_events (pool_id, block, log_index, tx_hash) VALUES (${poolId}, ${block}, ${logIndex}, ${txHash})`);
    }
  });

  afterAll(async () => {
    await t?.close();
  });

  const summary = async (variant: PopulationVariant, windowIds: number[] | null = null) => {
    const rows = await loadLabeledScores(t.db, ids.modelId, windowIds, variant);
    return { n: rows.length, pos: rows.filter((r) => r.profitable).length };
  };

  it("full: wszystkie zweryfikowane okazje poza `multi` (A, B, C, D, F, G)", async () => {
    expect(await summary("full")).toEqual({ n: 6, pos: 4 });
  });

  it("exclude_k0: dodatkowo bez konsumpcji z k=0 (odpada C)", async () => {
    expect(await summary("exclude_k0")).toEqual({ n: 5, pos: 3 });
  });

  it("bot_first: zostają konsumpcje z botem jako pierwszym swapem bloku B+k w pulach pary i k≥1 (B, F, G) oraz negatywy (D); odpadają A (obcy swap przed botem) i C (k=0)", async () => {
    expect(await summary("bot_first")).toEqual({ n: 4, pos: 2 });
  });

  it("bot_first: obcy swap w puli innej pary nie dyskwalifikuje (G zostaje); obcy swap tej pary przed botem dyskwalifikuje (A odpada)", async () => {
    // Usunięcie obcego swapu z bloku 1001 czyni A „bot pierwszy" → pozytywów przybywa o 1.
    await t.db.execute(sql`DELETE FROM swap_events WHERE block = 1001 AND tx_hash = ${tx(9)}`);
    expect(await summary("bot_first")).toEqual({ n: 5, pos: 3 });
    await t.db.execute(sql`INSERT INTO swap_events (pool_id, block, log_index, tx_hash) VALUES (${ids.poolA}, 1001, 3, ${tx(9)})`);
    expect(await summary("bot_first")).toEqual({ n: 4, pos: 2 });
  });

  it("filtr okien działa razem z wariantem; pusta lista okien → pusta populacja", async () => {
    expect(await summary("bot_first", [ids.windowId])).toEqual({ n: 4, pos: 2 });
    expect(await summary("bot_first", [ids.windowId + 1000])).toEqual({ n: 0, pos: 0 });
    expect(await summary("bot_first", [])).toEqual({ n: 0, pos: 0 });
  });

  it("evaluateModelOnWindow przekazuje wariant (n, n_positive z populacji wariantu); domyślnie `full`", async () => {
    const [model] = (await t.db.execute(sql`SELECT id, name, kind, version, metrics, trained_on_window_ids FROM scoring_models WHERE id = ${ids.modelId}`)) as unknown as ScoringModelRow[];
    const full = await evaluateModelOnWindow(t.db, model!, null);
    expect([full.n, full.n_positive]).toEqual([6, 4]);
    const botFirst = await evaluateModelOnWindow(t.db, model!, null, "bot_first");
    expect([botFirst.n, botFirst.n_positive]).toEqual([4, 2]);
    // score 80 dla pozytywów, 20 dla negatywów → separacja idealna w każdym wariancie
    expect(botFirst.auc).toBe(1);
    expect(botFirst.confusion).toEqual({ tp: 2, fp: 0, tn: 2, fn: 0 });
  });
});
