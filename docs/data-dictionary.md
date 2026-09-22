# Słownik danych

Generowany: `npm run data-dictionary` (`packages/db/scripts/data-dictionary.ts`) z modelu Drizzle `packages/db/src/schema/*.ts` + mapy jednostek `COLUMN_DOCS`. Nie edytować ręcznie.

## block_states

| Kolumna | Typ | NOT NULL | Domyślna | Jednostka | Opis |
|---|---|---|---|---|---|
| pair_id | integer | tak |  |  |  |
| window_id | integer | tak |  |  |  |
| block | bigint | tak |  |  |  |
| price_a | double precision | tak |  | quote/base | Cena w puli A (Uniswap V2): quote za 1 base. |
| price_b | double precision | tak |  | quote/base | Cena w puli B (Sushiswap). |
| spread_pct | double precision | tak |  | % | |p_A − p_B| / min(p_A, p_B) · 100 (bez obcięcia). |
| tvl_min_usd | double precision | tak |  | USD | TVL płytszej puli (2 · rezerwa quote · quoteUsd). |
| gas_price_median | double precision |  |  | GWEI | Cena gazu bloku, interpolowana dla bloków bez zdarzeń. |
| swaps_in_block | integer | tak | 0 | — | Liczba Swapów obu pul w bloku. |
| s | double precision | tak |  | % | Cecha S = spread obcięty do 3. |
| g | double precision | tak |  | % z 50 000 USD | Cecha G = koszt gazu 220k · gwei · ETHUSD / 50 000 · 100, obcięty do 2. |
| l | double precision | tak |  | mln USD | Cecha L = tvl_min_usd / 1e6, obcięta do 100. |
| m | double precision | tak |  | pkt 0–100 | Cecha M = 50 % percentyl swapów + 50 % percentyl gazu (w oknie). |
| opt_trade_usd | double precision |  |  | USD | Optymalny wolumen arbitrażu dwupulowego. |
| baseline_net_profit_usd | double precision |  |  | USD | gross − 220k · gwei · ETHUSD (baseline v1). |
| baseline_feasible | boolean |  |  |  |  |
| direction | direction_kind | tak | "none" | — | a_to_b: base tańszy na Uniswap (kup tam, sprzedaj na Sushi); b_to_a odwrotnie; none. |
| gross_profit_usd | double precision | tak | 0 | USD | Zysk brutto arbitrażu (0 bez kierunku). |

- PK: (pair_id, block)
- FK: pair_id → pairs.id ON DELETE NO ACTION
- FK: window_id → windows.id ON DELETE NO ACTION
- CHECK block_states_feature_ranges_check: "block_states"."s" >= 0 AND "block_states"."s" <= 3 AND "block_states"."g" >= 0 AND "block_states"."g" <= 2 AND "block_states"."l" >= 0 AND "block_states"."l" <= 100 AND "block_states"."m" >= 0 AND "block_states"."m" <= 100.000001
- CHECK block_states_nonnegative_check: "block_states"."spread_pct" >= 0 AND "block_states"."tvl_min_usd" >= 0
- INDEX block_states_window_idx (window_id, block)

## blocks

| Kolumna | Typ | NOT NULL | Domyślna | Jednostka | Opis |
|---|---|---|---|---|---|
| number | bigint | tak |  |  |  |
| timestamp | timestamp with time zone | tak |  | UTC | Znacznik czasu bloku (timestamptz). |
| base_fee | numeric(40, 0) |  |  | WEI | baseFeePerGas; NULL przed EIP-1559 (blok 12 965 000). |
| gas_price_median | numeric(40, 0) |  |  | WEI | Mediana gasPrice wszystkich tx bloku. UWAGA: block_states.gas_price_median jest w GWEI. |
| tx_count | integer |  |  | — | Liczba transakcji w bloku. |

- PK: (number)

## dexes

| Kolumna | Typ | NOT NULL | Domyślna | Jednostka | Opis |
|---|---|---|---|---|---|
| id | serial | tak |  |  |  |
| name | text | tak |  |  |  |
| factory | char(42) | tak |  |  |  |
| fee_bps | smallint | tak |  |  |  |

- PK: (id)
- UNIQUE (name)

## ingest_ranges

| Kolumna | Typ | NOT NULL | Domyślna | Jednostka | Opis |
|---|---|---|---|---|---|
| pool_id | integer | tak |  |  |  |
| from_block | bigint | tak |  | blok | Początek chunku ingestu (włącznie). |
| to_block | bigint | tak |  | blok | Koniec chunku ingestu (włącznie). |
| status | ingest_status | tak | "pending" |  |  |
| error | text |  |  |  |  |
| updated_at | timestamp with time zone | tak | now() |  |  |

- PK: (pool_id, from_block, to_block)
- FK: pool_id → pools.id ON DELETE NO ACTION
- CHECK ingest_ranges_from_le_to_check: "ingest_ranges"."from_block" <= "ingest_ranges"."to_block"

## jobs

| Kolumna | Typ | NOT NULL | Domyślna | Jednostka | Opis |
|---|---|---|---|---|---|
| id | serial | tak |  |  |  |
| type | job_type | tak |  |  |  |
| params | jsonb | tak | {} | JSON | Parametry zadania (schematy w @dex-arb/shared jobs.ts). |
| status | job_status | tak | "queued" |  |  |
| progress | integer | tak | 0 | % | Postęp zadania 0–100. |
| log | text | tak | "" |  |  |
| error | text |  |  |  |  |
| attempts | integer | tak | 0 |  |  |
| created_at | timestamp with time zone | tak | now() |  |  |
| started_at | timestamp with time zone |  |  |  |  |
| finished_at | timestamp with time zone |  |  |  |  |

- PK: (id)
- CHECK jobs_progress_range_check: "jobs"."progress" >= 0 AND "jobs"."progress" <= 100
- INDEX jobs_type_params_active_unique UNIQUE (type, params) WHERE "jobs"."status" IN ('queued', 'running')

## model_scores

| Kolumna | Typ | NOT NULL | Domyślna | Jednostka | Opis |
|---|---|---|---|---|---|
| model_id | integer | tak |  |  |  |
| pair_id | integer | tak |  |  |  |
| block | bigint | tak |  |  |  |
| score | double precision | tak |  | score 0–100 | Wynik modelu; ≥ 50 = klasa pozytywna. |
| label | feasibility_label | tak |  |  |  |

- PK: (model_id, pair_id, block)
- FK: model_id → scoring_models.id ON DELETE NO ACTION
- FK: pair_id → pairs.id ON DELETE NO ACTION
- CHECK model_scores_score_range_check: "model_scores"."score" >= 0 AND "model_scores"."score" <= 100

## opportunities

| Kolumna | Typ | NOT NULL | Domyślna | Jednostka | Opis |
|---|---|---|---|---|---|
| id | serial | tak |  |  |  |
| pair_id | integer | tak |  |  |  |
| window_id | integer | tak |  |  |  |
| block | bigint | tak |  |  |  |
| spread_pct | double precision | tak |  | % | Spread bloku-okazji (> 0,65 %). |
| direction | direction_kind | tak |  |  |  |
| est_profit_usd | double precision |  |  | USD | Szacunek a priori zysku netto (baseline v1). |

- PK: (id)
- FK: pair_id → pairs.id ON DELETE NO ACTION
- FK: window_id → windows.id ON DELETE NO ACTION
- UNIQUE opportunities_pair_block_unique (pair_id, block)
- CHECK opportunities_spread_nonnegative_check: "opportunities"."spread_pct" >= 0

## opportunity_verifications

| Kolumna | Typ | NOT NULL | Domyślna | Jednostka | Opis |
|---|---|---|---|---|---|
| opportunity_id | integer | tak |  |  |  |
| status | verification_status | tak |  |  |  |
| consumer_tx_hash | char(66) |  |  |  |  |
| realized_profit_usd | double precision |  |  | USD | Netto beneficjenta w tokenach pary (ETH≡WETH); NULL dla route = multi. |
| gas_used | numeric(40, 0) |  |  | gaz | gasUsed tx konsumującej. |
| gas_cost_usd | double precision |  |  | USD | gasUsed · effectiveGasPrice · ETHUSD bloku konsumpcji. |
| blocks_to_consumption | integer |  |  | bloki | Blok tx − blok okazji, 0..3 (K_MAX). |
| profitable_consumed | boolean | tak | false | — | consumed_atomic ∧ two_pool ∧ realized − gas > 0 (etykieta uczenia). |
| route | verification_route |  |  | — | two_pool = zysk policzalny; multi = agregator/więcej pul, etykieta nieokreślona; NULL poza consumed_atomic. |
| verified_at | timestamp with time zone | tak | now() |  |  |

- PK: (opportunity_id)
- FK: opportunity_id → opportunities.id ON DELETE CASCADE
- CHECK opportunity_verifications_route_status_check: "opportunity_verifications"."route" IS NULL OR "opportunity_verifications"."status" = 'consumed_atomic'
- CHECK opportunity_verifications_route_multi_unprofitable_check: NOT ("opportunity_verifications"."route" = 'multi' AND "opportunity_verifications"."profitable_consumed")
- CHECK opportunity_verifications_consumer_iff_consumed_check: ("opportunity_verifications"."consumer_tx_hash" IS NOT NULL) = ("opportunity_verifications"."status" IN ('consumed_atomic', 'consumed_partial'))
- CHECK opportunity_verifications_k_range_check: "opportunity_verifications"."blocks_to_consumption" IS NULL OR ("opportunity_verifications"."blocks_to_consumption" >= 0 AND "opportunity_verifications"."blocks_to_consumption" <= 3)

## pairs

| Kolumna | Typ | NOT NULL | Domyślna | Jednostka | Opis |
|---|---|---|---|---|---|
| id | serial | tak |  |  |  |
| symbol | text | tak |  |  |  |
| token_base | char(42) | tak |  |  |  |
| token_quote | char(42) | tak |  |  |  |

- PK: (id)
- FK: token_base → tokens.address ON DELETE NO ACTION
- FK: token_quote → tokens.address ON DELETE NO ACTION
- UNIQUE (symbol)
- CHECK pairs_tokens_differ_check: "pairs"."token_base" <> "pairs"."token_quote"

## pools

| Kolumna | Typ | NOT NULL | Domyślna | Jednostka | Opis |
|---|---|---|---|---|---|
| id | serial | tak |  |  |  |
| dex_id | integer | tak |  |  |  |
| pair_id | integer | tak |  |  |  |
| address | char(42) | tak |  |  |  |
| token0 | char(42) | tak |  |  |  |
| token1 | char(42) | tak |  |  |  |

- PK: (id)
- FK: dex_id → dexes.id ON DELETE NO ACTION
- FK: pair_id → pairs.id ON DELETE NO ACTION
- FK: token0 → tokens.address ON DELETE NO ACTION
- FK: token1 → tokens.address ON DELETE NO ACTION
- UNIQUE pools_dex_pair_unique (dex_id, pair_id)
- UNIQUE (address)
- CHECK pools_tokens_differ_check: "pools"."token0" <> "pools"."token1"

## scoring_models

| Kolumna | Typ | NOT NULL | Domyślna | Jednostka | Opis |
|---|---|---|---|---|---|
| id | serial | tak |  |  |  |
| name | text | tak |  |  |  |
| kind | model_kind | tak |  |  |  |
| version | integer | tak | 1 |  |  |
| params | jsonb | tak | {} | JSON | Parametry modelu (MamdaniParams / AnfisParams / BaselineV2Params). |
| trained_on_window_ids | integer[] |  |  |  |  |
| metrics | jsonb |  |  | JSON | AnfisMetrics / BaselineV2Metrics (population_block_states, population_verified, provenance) — schemat w @dex-arb/shared. |
| created_at | timestamp with time zone | tak | now() |  |  |

- PK: (id)
- UNIQUE scoring_models_name_version_unique (name, version)

## swap_events

| Kolumna | Typ | NOT NULL | Domyślna | Jednostka | Opis |
|---|---|---|---|---|---|
| pool_id | integer | tak |  |  |  |
| block | bigint | tak |  |  |  |
| log_index | integer | tak |  |  |  |
| tx_hash | char(66) | tak |  |  |  |
| sender | char(42) |  |  |  |  |
| to | char(42) |  |  |  |  |
| amount0_in | numeric(40, 0) |  |  | jedn. natywne token0 | Wpłata token0 w swapie. |
| amount0_out | numeric(40, 0) |  |  | jedn. natywne token0 | Wypłata token0 w swapie. |
| amount1_in | numeric(40, 0) |  |  | jedn. natywne token1 | Wpłata token1 w swapie. |
| amount1_out | numeric(40, 0) |  |  | jedn. natywne token1 | Wypłata token1 w swapie. |
| gas_price | numeric(40, 0) |  |  | WEI | Efektywna cena gazu tx swapu; NULL tylko po imporcie CSV. |

- PK: (pool_id, block, log_index)
- FK: pool_id → pools.id ON DELETE NO ACTION
- INDEX swap_events_block_idx (block)
- INDEX swap_events_tx_hash_idx (tx_hash)

## sync_events

| Kolumna | Typ | NOT NULL | Domyślna | Jednostka | Opis |
|---|---|---|---|---|---|
| pool_id | integer | tak |  |  |  |
| block | bigint | tak |  |  |  |
| log_index | integer | tak |  |  |  |
| tx_hash | char(66) | tak |  |  |  |
| reserve0 | numeric(40, 0) | tak |  | jedn. natywne token0 | Rezerwa token0 po zdarzeniu Sync (uint112). |
| reserve1 | numeric(40, 0) | tak |  | jedn. natywne token1 | Rezerwa token1 po zdarzeniu Sync (uint112). |

- PK: (pool_id, block, log_index)
- FK: pool_id → pools.id ON DELETE NO ACTION
- INDEX sync_events_block_idx (block)

## tokens

| Kolumna | Typ | NOT NULL | Domyślna | Jednostka | Opis |
|---|---|---|---|---|---|
| address | char(42) | tak |  |  |  |
| symbol | text | tak |  |  |  |
| decimals | smallint | tak |  |  |  |

- PK: (address)

## windows

| Kolumna | Typ | NOT NULL | Domyślna | Jednostka | Opis |
|---|---|---|---|---|---|
| id | serial | tak |  |  |  |
| name | text | tak |  |  |  |
| from_ts | timestamp with time zone | tak |  | UTC | Początek okna [from, to). |
| to_ts | timestamp with time zone | tak |  | UTC | Koniec okna (wyłącznie). |
| from_block | bigint |  |  | blok | Pierwszy blok o ts ≥ from_ts (seed-data lub binary search RPC). |
| to_block | bigint |  |  | blok | Ostatni blok o ts < to_ts. |

- PK: (id)
- UNIQUE (name)
- CHECK windows_ts_order_check: "windows"."from_ts" < "windows"."to_ts"
- CHECK windows_blocks_order_check: "windows"."from_block" IS NULL OR "windows"."to_block" IS NULL OR "windows"."from_block" <= "windows"."to_block"
