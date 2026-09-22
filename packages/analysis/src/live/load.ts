/**
 * Wejścia pollera z bazy (spec §3–§4): katalog par (pairs/pools/tokens/dexes; A = Uniswap V2,
 * B = Sushiswap wg PAIR_CONVENTION, jak `loadPairWindowInputs`) oraz parametry NAJNOWSZEGO
 * (max id) modelu każdego rodzaju. Brak wiersza albo niepoprawne params -> null + log (pigułka
 * „—" w widoku, nie awaria pollera — spec §10).
 */
import { asc, desc, eq } from "drizzle-orm";
import { AnfisModel, BaselineModel, BaselineV2Model } from "@dex-arb/core";
import { schema, type Db } from "@dex-arb/db";
import { PAIR_CONVENTION } from "../reserveStates.js";
import type { LivePair, LivePool } from "./sample.js";
import type { LiveModels } from "./score.js";

type Log = (msg: string) => void;
const noop: Log = () => {};

export async function loadLivePairs(db: Db, log: Log = noop): Promise<LivePair[]> {
  const pairRows = await db.select().from(schema.pairs).orderBy(asc(schema.pairs.id));
  const tokens = await db.select().from(schema.tokens);
  const tokenBy = new Map(tokens.map((t) => [t.address.toLowerCase(), t]));
  const poolRows = await db
    .select({
      pairId: schema.pools.pairId,
      address: schema.pools.address,
      token0: schema.pools.token0,
      token1: schema.pools.token1,
      dexName: schema.dexes.name,
      feeBps: schema.dexes.feeBps,
    })
    .from(schema.pools)
    .innerJoin(schema.dexes, eq(schema.pools.dexId, schema.dexes.id));

  const out: LivePair[] = [];
  for (const pair of pairRows) {
    const pools = poolRows.filter((p) => p.pairId === pair.id);
    const uni = pools.find((p) => p.dexName.toLowerCase() === PAIR_CONVENTION.a);
    const sushi = pools.find((p) => p.dexName.toLowerCase() === PAIR_CONVENTION.b);
    const base = tokenBy.get(pair.tokenBase.toLowerCase());
    const quote = tokenBy.get(pair.tokenQuote.toLowerCase());
    if (!uni || !sushi || !base || !quote) {
      log(`live: para ${pair.symbol} pominięta — brak puli Uniswap V2/Sushiswap albo tokena w katalogu`);
      continue;
    }
    const toPool = (p: typeof uni): LivePool => ({
      address: p.address.toLowerCase(),
      token0: p.token0.toLowerCase(),
      token1: p.token1.toLowerCase(),
      dexName: p.dexName,
      feeBps: p.feeBps,
    });
    out.push({
      id: pair.id,
      symbol: pair.symbol,
      tokenBase: pair.tokenBase.toLowerCase(),
      tokenQuote: pair.tokenQuote.toLowerCase(),
      decBase: base.decimals,
      decQuote: quote.decimals,
      baseSymbol: base.symbol,
      quoteSymbol: quote.symbol,
      poolA: toPool(uni),
      poolB: toPool(sushi),
    });
  }
  return out;
}

async function latestParams(db: Db, kind: "baseline_v2" | "anfis"): Promise<unknown> {
  const rows = await db
    .select({ params: schema.scoringModels.params })
    .from(schema.scoringModels)
    .where(eq(schema.scoringModels.kind, kind))
    .orderBy(desc(schema.scoringModels.id))
    .limit(1);
  return rows[0]?.params ?? null;
}

export async function loadLiveModels(db: Db, log: Log = noop): Promise<LiveModels> {
  const build = <T>(kind: "baseline_v2" | "anfis", params: unknown, ctor: (p: unknown) => T): T | null => {
    if (params === null) return null;
    try {
      return ctor(params);
    } catch (e) {
      log(`live: niepoprawne scoring_models.params modelu ${kind}: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
      return null;
    }
  };
  const [v2Params, anfisParams] = await Promise.all([latestParams(db, "baseline_v2"), latestParams(db, "anfis")]);
  return {
    baseline: new BaselineModel(),
    baselineV2: build("baseline_v2", v2Params, (p) => new BaselineV2Model(p as ConstructorParameters<typeof BaselineV2Model>[0])),
    anfis: build("anfis", anfisParams, (p) => new AnfisModel(p)),
  };
}
