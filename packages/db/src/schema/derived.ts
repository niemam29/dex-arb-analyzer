import { sql } from "drizzle-orm";
import {
  bigint, boolean, char, check, doublePrecision, index, integer, jsonb, numeric, pgEnum, pgTable,
  primaryKey, serial, text, timestamp, unique,
} from "drizzle-orm/pg-core";
import { pairs, windows } from "./config.js";

/**
 * Kierunek arbitrażu: kup w tańszej puli, sprzedaj w droższej. a = pula Uniswap V2,
 * b = pula Sushiswap. Enum zamiast text, żeby zapisywalne wartości były ograniczone do
 * zbioru domkniętego; wartości TS "a->b"/"b->a" mapowane są na "a_to_b"/"b_to_a" na
 * granicy zapisu do bazy, patrz `packages/analysis/src/db.ts`.
 */
export const directionKindEnum = pgEnum("direction_kind", ["none", "a_to_b", "b_to_a"]);

/**
 * Etykieta lingwistyczna wyjścia W modelu oceny (kolejność rosnącej wykonalności) — musi
 * być zgodna z `LABELS` w `@dex-arb/core` (types.ts); duplikowana tu jako literały, bo
 * `@dex-arb/db` celowo nie zależy od `@dex-arb/core`.
 */
export const feasibilityLabelEnum = pgEnum("feasibility_label", [
  "niewykonalna",
  "ryzykowna",
  "wykonalna",
  "atrakcyjna",
]);

/**
 * Stan pary po każdym bloku okna + cechy S/G/L/M + baseline. PK (pair_id, block).
 * direction/grossProfitUsd: kierunek arbitrażu i zysk brutto (przed odjęciem gazu) liczone
 * dla każdego bloku niezależnie od progu opportunities. A = pula na Uniswap V2, B = pula na
 * Sushiswap. `gas_price_median` tej tabeli jest w GWEI (double precision) — w przeciwieństwie
 * do `blocks.gas_price_median`, które jest w WEI (numeric); patrz `loadInputs.ts`, gdzie
 * następuje konwersja.
 */
export const blockStates = pgTable(
  "block_states",
  {
    pairId: integer("pair_id").notNull().references(() => pairs.id),
    windowId: integer("window_id").notNull().references(() => windows.id),
    block: bigint("block", { mode: "number" }).notNull(),
    priceA: doublePrecision("price_a").notNull(),
    priceB: doublePrecision("price_b").notNull(),
    spreadPct: doublePrecision("spread_pct").notNull(),
    tvlMinUsd: doublePrecision("tvl_min_usd").notNull(),
    gasPriceMedian: doublePrecision("gas_price_median"),
    swapsInBlock: integer("swaps_in_block").notNull().default(0),
    s: doublePrecision("s").notNull(),
    g: doublePrecision("g").notNull(),
    l: doublePrecision("l").notNull(),
    m: doublePrecision("m").notNull(),
    optTradeUsd: doublePrecision("opt_trade_usd"),
    baselineNetProfitUsd: doublePrecision("baseline_net_profit_usd"),
    baselineFeasible: boolean("baseline_feasible"),
    direction: directionKindEnum("direction").notNull().default("none"),
    grossProfitUsd: doublePrecision("gross_profit_usd").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.pairId, t.block] }),
    index("block_states_window_idx").on(t.windowId, t.block),
    // Dziedziny cech FIS (S≤3, G≤2, L≤100, M∈[0,100]) — obcięcia w core/features.ts; tolerancja 1e-6 dla M (suma dwóch połówek percentyli w double).
    check("block_states_feature_ranges_check", sql`${t.s} >= 0 AND ${t.s} <= 3 AND ${t.g} >= 0 AND ${t.g} <= 2 AND ${t.l} >= 0 AND ${t.l} <= 100 AND ${t.m} >= 0 AND ${t.m} <= 100.000001`),
    check("block_states_nonnegative_check", sql`${t.spreadPct} >= 0 AND ${t.tvlMinUsd} >= 0`),
  ],
);

/** Bloki ze spreadem > próg (0,65 %). direction: 'a_to_b' | 'b_to_a' (kup w tańszej, sprzedaj w droższej). */
export const opportunities = pgTable(
  "opportunities",
  {
    id: serial("id").primaryKey(),
    pairId: integer("pair_id").notNull().references(() => pairs.id),
    windowId: integer("window_id").notNull().references(() => windows.id),
    block: bigint("block", { mode: "number" }).notNull(),
    spreadPct: doublePrecision("spread_pct").notNull(),
    direction: directionKindEnum("direction").notNull(),
    estProfitUsd: doublePrecision("est_profit_usd"),
  },
  (t) => [
    /**
     * unique zamiast zwykłego indeksu: joby analyze:pair-window muszą być idempotentne —
     * upsert on conflict (pair_id, block).
     */
    unique("opportunities_pair_block_unique").on(t.pairId, t.block),
    check("opportunities_spread_nonnegative_check", sql`${t.spreadPct} >= 0`),
  ],
);

export const verificationStatusEnum = pgEnum("verification_status", [
  "consumed_atomic",
  "consumed_partial",
  "decayed",
  "persisted",
]);

/**
 * Klasyfikacja trasy tx konsumującej (tylko dla `consumed_atomic`; `classifyRoute` w
 * `packages/analysis/src/verify/route.ts`): `two_pool` — dokładnie dwa swapy przez obie pule
 * pary (zysk dwupulowy policzalny), `multi` — routing przez agregator / więcej pul (zysk
 * NIEZNANY: `realized_profit_usd` = NULL, etykieta uczenia nieokreślona — taki wiersz jest
 * wykluczany z populacji etykiet, jak `nSkippedUnknown` w `anfis/dataset.ts`). NULL dla statusów
 * innych niż `consumed_atomic` — wymuszone CHECK-iem (migracja 0005).
 */
export const verificationRouteEnum = pgEnum("verification_route", ["two_pool", "multi"]);

export const opportunityVerifications = pgTable(
  "opportunity_verifications",
  {
    // ON DELETE CASCADE (migracja 0004): writeOpportunities usuwa okazje,
    // których blok wypadł z aktualnego przebiegu analyze:pair-window (opuszczenie okna, ponowna
    // analiza) — bez CASCADE taki DELETE rzucałby naruszeniem klucza obcego, gdy okazja ma już
    // wiersz weryfikacji. Reweryfikacja po ponownej analizie jest deterministyczna (verify:pair-
    // window można uruchomić ponownie), więc utrata wiersza weryfikacji usuniętej okazji jest
    // zamierzona.
    opportunityId: integer("opportunity_id").primaryKey().references(() => opportunities.id, { onDelete: "cascade" }),
    status: verificationStatusEnum("status").notNull(),
    consumerTxHash: char("consumer_tx_hash", { length: 66 }),
    realizedProfitUsd: doublePrecision("realized_profit_usd"),
    gasUsed: numeric("gas_used", { precision: 40, scale: 0 }),
    gasCostUsd: doublePrecision("gas_cost_usd"),
    blocksToConsumption: integer("blocks_to_consumption"),
    /** etykieta uczenia ANFIS: consumed_atomic ∧ realized_profit − gas_cost > 0 */
    profitableConsumed: boolean("profitable_consumed").notNull().default(false),
    /** trasa tx konsumującej; NULL, gdy status ≠ consumed_atomic (CHECK) */
    route: verificationRouteEnum("route"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("opportunity_verifications_route_status_check", sql`${t.route} IS NULL OR ${t.status} = 'consumed_atomic'`),
    // trasa 'multi' = zysk nieznany, więc nie może być zarazem etykietą pozytywną
    check("opportunity_verifications_route_multi_unprofitable_check", sql`NOT (${t.route} = 'multi' AND ${t.profitableConsumed})`),
    // tx konsumująca istnieje wtedy i tylko wtedy, gdy okazja została skonsumowana (atomowo lub częściowo)
    check("opportunity_verifications_consumer_iff_consumed_check", sql`(${t.consumerTxHash} IS NOT NULL) = (${t.status} IN ('consumed_atomic', 'consumed_partial'))`),
    // horyzont weryfikacji K_MAX = 3 (packages/core/src/constants.ts)
    check("opportunity_verifications_k_range_check", sql`${t.blocksToConsumption} IS NULL OR (${t.blocksToConsumption} >= 0 AND ${t.blocksToConsumption} <= 3)`),
  ],
);

/** `baseline_v2` = baseline skalibrowany (migracja 0006, `ALTER TYPE ... ADD VALUE`) — patrz `BaselineV2Model` w `@dex-arb/core`. */
export const modelKindEnum = pgEnum("model_kind", ["baseline", "mamdani", "anfis", "baseline_v2"]);

/** UNIQUE (name, version) — `ensureScoringModels` upsertuje po tym kluczu. */
export const scoringModels = pgTable(
  "scoring_models",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    kind: modelKindEnum("kind").notNull(),
    version: integer("version").notNull().default(1),
    /** parametry modelu, np. MamdaniParams */
    params: jsonb("params").notNull().default({}),
    trainedOnWindowIds: integer("trained_on_window_ids").array(),
    metrics: jsonb("metrics"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("scoring_models_name_version_unique").on(t.name, t.version)],
);

export const modelScores = pgTable(
  "model_scores",
  {
    modelId: integer("model_id").notNull().references(() => scoringModels.id),
    pairId: integer("pair_id").notNull().references(() => pairs.id),
    block: bigint("block", { mode: "number" }).notNull(),
    score: doublePrecision("score").notNull(),
    label: feasibilityLabelEnum("label").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.modelId, t.pairId, t.block] }),
    check("model_scores_score_range_check", sql`${t.score} >= 0 AND ${t.score} <= 100`),
  ],
);
