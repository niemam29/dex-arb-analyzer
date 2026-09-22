// Zapytania dla GET /pairs/:id/windows/:wid/opportunities i GET /opportunities/:id: lista okazji
// z paginacją/filtrami + LEFT JOIN opcjonalnego modelu ocen (po nazwie, najnowsza wersja);
// szczegóły okazji dokładają block_states, rezerwy obu pul (ostatni Sync <= blok okazji, per
// pula) i aktywacje reguł Mamdaniego liczone ON-THE-FLY przez @dex-arb/core z parametrów modelu
// 'mamdani' zapisanych w scoring_models.params — deterministyczne i tanie (evaluate() na jednym
// punkcie), więc NIE przechowujemy ich w bazie.
import { sql } from "drizzle-orm";
import type { Db } from "@dex-arb/db";
import { createMamdaniModel, type RuleActivation } from "@dex-arb/core";
import type {
  OpportunityDetail,
  OpportunityList,
  OpportunityListItem,
  OpportunityListQuery,
  PoolReserveDto,
  VerificationDto,
} from "@dex-arb/shared";
import { HttpError } from "../plugins/zod.js";

type OppListRow = {
  id: number;
  block: number;
  spread_pct: number;
  direction: string;
  est_profit_usd: number | null;
  status: VerificationDto["status"] | null;
  route: VerificationDto["route"];
  consumer_tx_hash: string | null;
  realized_profit_usd: number | null;
  gas_used: string | null;
  gas_cost_usd: number | null;
  blocks_to_consumption: number | null;
  profitable_consumed: boolean | null;
  verified_at: string | null;
  model_score: number | null;
  model_label: string | null;
};

function toVerification(r: OppListRow): VerificationDto | null {
  if (r.status == null) return null;
  return {
    status: r.status,
    route: r.route,
    consumer_tx_hash: r.consumer_tx_hash,
    realized_profit_usd: r.realized_profit_usd,
    gas_used: r.gas_used,
    gas_cost_usd: r.gas_cost_usd,
    blocks_to_consumption: r.blocks_to_consumption,
    profitable_consumed: r.profitable_consumed ?? false,
    verified_at: r.verified_at,
  };
}

export interface OpportunityListArgs {
  pairId: number;
  windowId: number;
  status?: OpportunityListQuery["status"] | undefined;
  minSpread?: number | undefined;
  /** Nazwa modelu (scoring_models.name), NIE id — patrz dto/opportunities.ts. */
  model?: string | undefined;
  page: number;
  pageSize: number;
}

export async function loadOpportunityList(db: Db, a: OpportunityListArgs): Promise<OpportunityList> {
  const pair = (await db.execute(sql`SELECT 1 FROM pairs WHERE id = ${a.pairId}`)) as unknown[];
  if (pair.length === 0) throw new HttpError(404, `Para o id=${a.pairId} nie istnieje`);
  const win = (await db.execute(sql`SELECT 1 FROM windows WHERE id = ${a.windowId}`)) as unknown[];
  if (win.length === 0) throw new HttpError(404, `Okno o id=${a.windowId} nie istnieje`);

  // Model po NAZWIE, najnowsza wersja (UNIQUE (name, version) w scoring_models) — brak
  // dopasowania nie jest błędem, tylko pustą mapą scores dla wszystkich pozycji (ten sam
  // domyślny brak-danych co dla bloku bez jeszcze policzonego wyniku modelu).
  let modelId: number | null = null;
  if (a.model) {
    const rows = (await db.execute(
      sql`SELECT id FROM scoring_models WHERE name = ${a.model} ORDER BY version DESC LIMIT 1`,
    )) as { id: number }[];
    modelId = rows[0]?.id ?? null;
  }

  const conditions = [sql`o.pair_id = ${a.pairId}`, sql`o.window_id = ${a.windowId}`];
  if (a.minSpread != null) conditions.push(sql`o.spread_pct >= ${a.minSpread}`);
  if (a.status === "unverified") conditions.push(sql`ov.opportunity_id IS NULL`);
  else if (a.status) conditions.push(sql`ov.status = ${a.status}`);
  const where = sql.join(conditions, sql` AND `);

  const countRows = (await db.execute(sql`
    SELECT count(*)::int AS total
    FROM opportunities o
    LEFT JOIN opportunity_verifications ov ON ov.opportunity_id = o.id
    WHERE ${where}
  `)) as { total: number }[];
  const total = countRows[0]?.total ?? 0;

  // JOIN i kolumny modelu muszą być spójne: samo puste `modelJoin` przy nieusuniętym
  // `ms.score`/`ms.label` w SELECT dałoby "missing FROM-clause entry for table ms" (bug
  // znaleziony debugiem tego taska — Postgres nie toleruje odwołania do aliasu bez JOIN-a).
  const modelJoin =
    modelId != null
      ? sql`LEFT JOIN model_scores ms ON ms.model_id = ${modelId} AND ms.pair_id = o.pair_id AND ms.block = o.block`
      : sql``;
  const modelSelect = modelId != null ? sql`, ms.score AS model_score, ms.label AS model_label` : sql`, NULL AS model_score, NULL AS model_label`;

  const rows = (await db.execute(sql`
    SELECT o.id, o.block::int AS block, o.spread_pct, o.direction, o.est_profit_usd,
      ov.status, ov.route, ov.consumer_tx_hash, ov.realized_profit_usd, ov.gas_used::text AS gas_used,
      ov.gas_cost_usd, ov.blocks_to_consumption, ov.profitable_consumed,
      to_char(ov.verified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS verified_at
      ${modelSelect}
    FROM opportunities o
    LEFT JOIN opportunity_verifications ov ON ov.opportunity_id = o.id
    ${modelJoin}
    WHERE ${where}
    ORDER BY o.block ASC
    LIMIT ${a.pageSize} OFFSET ${(a.page - 1) * a.pageSize}
  `)) as unknown as OppListRow[];

  const items: OpportunityListItem[] = rows.map((r) => ({
    id: r.id,
    block: r.block,
    spread_pct: r.spread_pct,
    direction: r.direction,
    est_profit_usd: r.est_profit_usd,
    verification: toVerification(r),
    scores: a.model
      ? { [a.model]: r.model_score != null ? { score: r.model_score, label: r.model_label! } : null }
      : {},
  }));

  return { items, page: a.page, page_size: a.pageSize, total };
}

type OppDetailRow = {
  id: number;
  pair_id: number;
  window_id: number;
  block: number;
  spread_pct: number;
  direction: string;
  est_profit_usd: number | null;
};
type StateRow = {
  price_a: number;
  price_b: number;
  tvl_min_usd: number;
  gas_price_median: number | null;
  s: number;
  g: number;
  l: number;
  m: number;
  opt_trade_usd: number | null;
  baseline_net_profit_usd: number | null;
  gross_profit_usd: number;
  baseline_feasible: boolean | null;
};
type ReserveRow = { pool_id: number; dex_name: string; block: number | null; reserve0: string | null; reserve1: string | null };

export async function loadOpportunityDetail(db: Db, id: number): Promise<OpportunityDetail | null> {
  const oppRows = (await db.execute(sql`
    SELECT id, pair_id, window_id, block::int AS block, spread_pct, direction, est_profit_usd
    FROM opportunities WHERE id = ${id}
  `)) as unknown as OppDetailRow[];
  const opp = oppRows[0];
  if (!opp) return null;

  const verRows = (await db.execute(sql`
    SELECT status, route, consumer_tx_hash, realized_profit_usd, gas_used::text AS gas_used, gas_cost_usd,
      blocks_to_consumption, profitable_consumed,
      to_char(verified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS verified_at
    FROM opportunity_verifications WHERE opportunity_id = ${id}
  `)) as unknown as VerificationDto[];
  const ver = verRows[0] ?? null;

  const stateRows = (await db.execute(sql`
    SELECT price_a, price_b, tvl_min_usd, gas_price_median, s, g, l, m,
      opt_trade_usd, baseline_net_profit_usd, gross_profit_usd, baseline_feasible
    FROM block_states WHERE pair_id = ${opp.pair_id} AND block = ${opp.block}
  `)) as unknown as StateRow[];
  const state = stateRows[0];
  // Niezmiennik: opportunities.block jest podzbiorem block_states dla tej samej (pair_id,
  // block) — writeOpportunities (packages/analysis) zapisuje okazje TYLKO z bloków, dla
  // których block_states już istnieje. Brak wiersza tutaj to niespójność danych, nie błąd
  // wejścia klienta -> 500 (goły Error, jak niezgodność kontraktu w app.ts), nie HttpError 400/404.
  if (!state) throw new Error(`Brak block_states dla pair_id=${opp.pair_id}, block=${opp.block}`);

  const reserveRows = (await db.execute(sql`
    SELECT pl.id AS pool_id, d.name AS dex_name, se.block::int AS block,
      se.reserve0::text AS reserve0, se.reserve1::text AS reserve1
    FROM pools pl
    JOIN dexes d ON d.id = pl.dex_id
    LEFT JOIN LATERAL (
      SELECT block, reserve0, reserve1 FROM sync_events
      WHERE pool_id = pl.id AND block <= ${opp.block}
      ORDER BY block DESC, log_index DESC LIMIT 1
    ) se ON true
    WHERE pl.pair_id = ${opp.pair_id}
    ORDER BY pl.id
  `)) as unknown as ReserveRow[];
  const reserves: PoolReserveDto[] = reserveRows.map((r) => ({
    pool_id: r.pool_id,
    dex_name: r.dex_name,
    block: r.block,
    reserve0: r.reserve0,
    reserve1: r.reserve1,
  }));

  // Model 'mamdani' najnowszej wersji — parametry z scoring_models.params (NIE
  // DEFAULT_MAMDANI_PARAMS zaszyte w kodzie), żeby aktywacje odzwierciedlały faktycznie
  // wytrenowany/skalibrowany model zapisany w bazie. Brak wiersza modelu (np. baza testowa bez
  // seeda mamdani) -> puste activations, nie błąd.
  const modelRows = (await db.execute(
    sql`SELECT params FROM scoring_models WHERE kind = 'mamdani' ORDER BY version DESC LIMIT 1`,
  )) as { params: unknown }[];
  let ruleActivations: RuleActivation[] = [];
  if (modelRows[0]) {
    const model = createMamdaniModel(modelRows[0].params);
    const result = model.score({
      S: state.s,
      G: state.g,
      L: state.l,
      M: state.m,
      netProfitUsd: state.baseline_net_profit_usd ?? 0,
      grossProfitUsd: state.gross_profit_usd,
      optTradeUsd: state.opt_trade_usd ?? 0,
    });
    ruleActivations = (result.details as { activations: RuleActivation[] } | undefined)?.activations ?? [];
  }

  return {
    id: opp.id,
    pair_id: opp.pair_id,
    window_id: opp.window_id,
    block: opp.block,
    spread_pct: opp.spread_pct,
    direction: opp.direction,
    est_profit_usd: opp.est_profit_usd,
    verification: ver,
    scores: {},
    price_a: state.price_a,
    price_b: state.price_b,
    tvl_min_usd: state.tvl_min_usd,
    gas_price_median: state.gas_price_median,
    s: state.s,
    g: state.g,
    l: state.l,
    m: state.m,
    opt_trade_usd: state.opt_trade_usd,
    baseline_net_profit_usd: state.baseline_net_profit_usd,
    baseline_feasible: state.baseline_feasible,
    reserves,
    rule_activations: ruleActivations,
    etherscan_url: ver?.consumer_tx_hash ? `https://etherscan.io/tx/${ver.consumer_tx_hash}` : null,
  };
}
