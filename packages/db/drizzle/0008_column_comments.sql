-- Komentarze jednostek/znaczenia kolumn (ręczna migracja; drizzle-kit nie modeluje COMMENT). Źródło prawdy: packages/db/scripts/data-dictionary-render.ts (COLUMN_DOCS).
COMMENT ON COLUMN "blocks"."timestamp" IS 'Znacznik czasu bloku (timestamptz) [UTC].';--> statement-breakpoint
COMMENT ON COLUMN "blocks"."base_fee" IS 'baseFeePerGas bloku [WEI]; NULL przed EIP-1559 (blok 12 965 000).';--> statement-breakpoint
COMMENT ON COLUMN "blocks"."gas_price_median" IS 'Mediana gasPrice wszystkich tx bloku [WEI] (numeric). UWAGA: block_states.gas_price_median jest w GWEI.';--> statement-breakpoint
COMMENT ON COLUMN "blocks"."tx_count" IS 'Liczba transakcji w bloku.';--> statement-breakpoint
COMMENT ON COLUMN "sync_events"."reserve0" IS 'Rezerwa token0 po zdarzeniu Sync (uint112) [jedn. natywne token0].';--> statement-breakpoint
COMMENT ON COLUMN "sync_events"."reserve1" IS 'Rezerwa token1 po zdarzeniu Sync (uint112) [jedn. natywne token1].';--> statement-breakpoint
COMMENT ON COLUMN "swap_events"."amount0_in" IS 'Wpłata token0 w swapie [jedn. natywne token0].';--> statement-breakpoint
COMMENT ON COLUMN "swap_events"."amount0_out" IS 'Wypłata token0 w swapie [jedn. natywne token0].';--> statement-breakpoint
COMMENT ON COLUMN "swap_events"."amount1_in" IS 'Wpłata token1 w swapie [jedn. natywne token1].';--> statement-breakpoint
COMMENT ON COLUMN "swap_events"."amount1_out" IS 'Wypłata token1 w swapie [jedn. natywne token1].';--> statement-breakpoint
COMMENT ON COLUMN "swap_events"."gas_price" IS 'effective gas price transakcji swapu [WEI]; NULL tylko dla importu CSV.';--> statement-breakpoint
COMMENT ON COLUMN "ingest_ranges"."from_block" IS 'Początek chunku ingestu (włącznie) [blok].';--> statement-breakpoint
COMMENT ON COLUMN "ingest_ranges"."to_block" IS 'Koniec chunku ingestu (włącznie) [blok].';--> statement-breakpoint
COMMENT ON COLUMN "windows"."from_ts" IS 'Początek okna [from, to) [UTC].';--> statement-breakpoint
COMMENT ON COLUMN "windows"."to_ts" IS 'Koniec okna (wyłącznie) [UTC].';--> statement-breakpoint
COMMENT ON COLUMN "windows"."from_block" IS 'Pierwszy blok o ts ≥ from_ts (seed-data lub binary search RPC) [blok].';--> statement-breakpoint
COMMENT ON COLUMN "windows"."to_block" IS 'Ostatni blok o ts < to_ts [blok].';--> statement-breakpoint
COMMENT ON COLUMN "block_states"."price_a" IS 'Cena w puli A (Uniswap V2): quote za 1 base [quote/base].';--> statement-breakpoint
COMMENT ON COLUMN "block_states"."price_b" IS 'Cena w puli B (Sushiswap) [quote/base].';--> statement-breakpoint
COMMENT ON COLUMN "block_states"."spread_pct" IS '|p_A − p_B| / min(p_A, p_B) · 100 (bez obcięcia) [%].';--> statement-breakpoint
COMMENT ON COLUMN "block_states"."tvl_min_usd" IS 'TVL płytszej puli (2 · rezerwa quote · quoteUsd) [USD].';--> statement-breakpoint
COMMENT ON COLUMN "block_states"."gas_price_median" IS 'Cena gazu bloku [GWEI] (double), interpolowana dla bloków bez zdarzeń.';--> statement-breakpoint
COMMENT ON COLUMN "block_states"."swaps_in_block" IS 'Liczba Swapów obu pul w bloku.';--> statement-breakpoint
COMMENT ON COLUMN "block_states"."s" IS 'Cecha S: spread [%] obcięty do 3.';--> statement-breakpoint
COMMENT ON COLUMN "block_states"."g" IS 'Cecha G: koszt gazu arbitrażu (220k gaz) jako % z 50 000 USD, obcięty do 2.';--> statement-breakpoint
COMMENT ON COLUMN "block_states"."l" IS 'Cecha L: TVL płytszej puli [mln USD], obcięta do 100.';--> statement-breakpoint
COMMENT ON COLUMN "block_states"."m" IS 'Cecha M: ryzyko MEV [pkt 0–100] = 50 % percentyl swapów w bloku + 50 % percentyl gazu (w oknie).';--> statement-breakpoint
COMMENT ON COLUMN "block_states"."opt_trade_usd" IS 'Optymalny wolumen arbitrażu dwupulowego [USD].';--> statement-breakpoint
COMMENT ON COLUMN "block_states"."baseline_net_profit_usd" IS 'gross − 220k · gwei · ETHUSD (baseline v1) [USD].';--> statement-breakpoint
COMMENT ON COLUMN "block_states"."gross_profit_usd" IS 'Zysk brutto arbitrażu (0 bez kierunku) [USD].';--> statement-breakpoint
COMMENT ON COLUMN "block_states"."direction" IS 'a_to_b: base tańszy na Uniswap (kup tam, sprzedaj na Sushi); b_to_a odwrotnie; none.';--> statement-breakpoint
COMMENT ON COLUMN "opportunities"."spread_pct" IS 'Spread bloku-okazji (> 0,65 %) [%].';--> statement-breakpoint
COMMENT ON COLUMN "opportunities"."est_profit_usd" IS 'Szacunek a priori zysku netto (baseline v1) [USD].';--> statement-breakpoint
COMMENT ON COLUMN "opportunity_verifications"."realized_profit_usd" IS 'Netto beneficjenta w tokenach pary (ETH≡WETH); NULL dla route = multi [USD].';--> statement-breakpoint
COMMENT ON COLUMN "opportunity_verifications"."gas_used" IS 'gasUsed tx konsumującej [gaz].';--> statement-breakpoint
COMMENT ON COLUMN "opportunity_verifications"."gas_cost_usd" IS 'gasUsed · effectiveGasPrice · ETHUSD bloku konsumpcji [USD].';--> statement-breakpoint
COMMENT ON COLUMN "opportunity_verifications"."blocks_to_consumption" IS 'Blok tx − blok okazji, 0..3 (K_MAX) [bloki].';--> statement-breakpoint
COMMENT ON COLUMN "opportunity_verifications"."profitable_consumed" IS 'consumed_atomic ∧ two_pool ∧ realized − gas > 0 (etykieta uczenia).';--> statement-breakpoint
COMMENT ON COLUMN "opportunity_verifications"."route" IS 'two_pool = zysk policzalny; multi = agregator/więcej pul, etykieta nieokreślona; NULL poza consumed_atomic.';--> statement-breakpoint
COMMENT ON COLUMN "scoring_models"."params" IS 'Parametry modelu (MamdaniParams / AnfisParams / BaselineV2Params) [JSON].';--> statement-breakpoint
COMMENT ON COLUMN "scoring_models"."metrics" IS 'AnfisMetrics / BaselineV2Metrics (population_block_states, population_verified, provenance) — schemat w @dex-arb/shared [JSON].';--> statement-breakpoint
COMMENT ON COLUMN "model_scores"."score" IS 'Wynik modelu; ≥ 50 = klasa pozytywna [score 0–100].';--> statement-breakpoint
COMMENT ON COLUMN "jobs"."progress" IS 'Postęp zadania 0–100 [%].';--> statement-breakpoint
COMMENT ON COLUMN "jobs"."params" IS 'Parametry zadania (schematy w @dex-arb/shared jobs.ts) [JSON].';
