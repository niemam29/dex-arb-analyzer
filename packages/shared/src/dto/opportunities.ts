// DTO API dla okazji arbitrażowych — odpowiada `opportunities` +
// `opportunity_verifications` + `block_states` + `model_scores`/`scoring_models` w
// `@dex-arb/db` (packages/db/src/schema/derived.ts). Pola snake_case (zgodnie z aliasami SQL
// pozostałych DTO API, patrz dto/jobs.ts).
import { z } from "zod";

export const VERIFICATION_STATUSES = ["consumed_atomic", "consumed_partial", "decayed", "persisted"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * Query GET /pairs/:id/windows/:wid/opportunities. `status` przyjmuje status weryfikacji
 * ALBO literał 'unverified' (okazja bez wiersza w opportunity_verifications). `model` to NAZWA
 * modelu z `scoring_models.name` (nie id) — dołącza jego score/label do mapy `scores` w
 * odpowiedzi. Sortowanie zawsze po `block` rosnąco.
 */
export const OpportunityListQuery = z
  .object({
    status: z.enum([...VERIFICATION_STATUSES, "unverified"]).optional(),
    min_spread: z.coerce.number().min(0).optional(),
    model: z.string().min(1).optional(),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(500).default(50),
  })
  // Nieznany klucz query -> 400 (spójnie z pozostałymi schematami query API).
  .strict();
export type OpportunityListQuery = z.infer<typeof OpportunityListQuery>;

export const VERIFICATION_ROUTES = ["two_pool", "multi"] as const;
export type VerificationRoute = (typeof VERIFICATION_ROUTES)[number];

export const VerificationDto = z.object({
  status: z.enum(VERIFICATION_STATUSES),
  /**
   * Trasa tx konsumującej — tylko dla `consumed_atomic` (kolumna `route`, migracja 0005):
   * `two_pool` = 2 swapy przez obie pule pary (zysk policzalny), `multi` = agregator/więcej pul
   * (zysk NIEZNANY, `realized_profit_usd` null, poza populacją etykiet). `null` dla pozostałych
   * statusów.
   */
  route: z.enum(VERIFICATION_ROUTES).nullable(),
  consumer_tx_hash: z.string().nullable(),
  realized_profit_usd: z.number().nullable(),
  /** numeric(40,0) w bazie -> string (poza bezpiecznym zakresem number). */
  gas_used: z.string().nullable(),
  gas_cost_usd: z.number().nullable(),
  blocks_to_consumption: z.number().int().nullable(),
  profitable_consumed: z.boolean(),
  verified_at: z.string().nullable(),
});
export type VerificationDto = z.infer<typeof VerificationDto>;

export const ModelScoreDto = z.object({ score: z.number(), label: z.string() });
export type ModelScoreDto = z.infer<typeof ModelScoreDto>;

export const OpportunityListItem = z.object({
  id: z.number().int(),
  block: z.number().int(),
  spread_pct: z.number(),
  direction: z.string(),
  est_profit_usd: z.number().nullable(),
  verification: VerificationDto.nullable(),
  /**
   * Klucz: nazwa modelu (tylko ten podany w `?model=`, jeśli w ogóle) -> {score,label}, albo
   * `null`, gdy model istnieje, ale nie ma jeszcze wyniku dla tego bloku. Brak parametru
   * `model` w żądaniu -> pusta mapa.
   */
  scores: z.record(z.string(), ModelScoreDto.nullable()),
});
export type OpportunityListItem = z.infer<typeof OpportunityListItem>;

export const OpportunityList = z.object({
  items: z.array(OpportunityListItem),
  page: z.number().int(),
  page_size: z.number().int(),
  total: z.number().int(),
});
export type OpportunityList = z.infer<typeof OpportunityList>;

export const PoolReserveDto = z.object({
  pool_id: z.number().int(),
  dex_name: z.string(),
  /** Blok ostatniego znanego Sync <= blok okazji; `null`, gdy pula nie ma jeszcze żadnego. */
  block: z.number().int().nullable(),
  /** numeric(40,0) w bazie -> string. */
  reserve0: z.string().nullable(),
  reserve1: z.string().nullable(),
});
export type PoolReserveDto = z.infer<typeof PoolReserveDto>;

export const RuleActivationDto = z.object({ id: z.string(), strength: z.number() });
export type RuleActivationDto = z.infer<typeof RuleActivationDto>;

/**
 * GET /opportunities/:id — rozszerza OpportunityListItem o pola block_states (cechy S/G/L/M +
 * baseline), rezerwy obu pul (ostatni Sync <= blok, per pula) i aktywacje reguł Mamdaniego
 * liczone on-the-fly (model 'mamdani' najnowszej wersji z `scoring_models.params` — nie
 * przechowujemy ich w bazie, patrz queries/opportunities.sql.ts).
 */
export const OpportunityDetail = OpportunityListItem.extend({
  pair_id: z.number().int(),
  window_id: z.number().int(),
  price_a: z.number(),
  price_b: z.number(),
  tvl_min_usd: z.number(),
  gas_price_median: z.number().nullable(),
  s: z.number(),
  g: z.number(),
  l: z.number(),
  m: z.number(),
  opt_trade_usd: z.number().nullable(),
  baseline_net_profit_usd: z.number().nullable(),
  baseline_feasible: z.boolean().nullable(),
  reserves: z.array(PoolReserveDto),
  rule_activations: z.array(RuleActivationDto),
  /** https://etherscan.io/tx/<consumer_tx_hash>, `null` gdy brak weryfikacji/tx. */
  etherscan_url: z.string().nullable(),
});
export type OpportunityDetail = z.infer<typeof OpportunityDetail>;
