CREATE TYPE "public"."ingest_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."model_kind" AS ENUM('baseline', 'mamdani', 'anfis');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('consumed_atomic', 'consumed_partial', 'decayed', 'persisted');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('ingest:pool-window', 'analyze:pair-window', 'verify:pair-window', 'import:csv', 'train');--> statement-breakpoint
CREATE TABLE "dexes" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"factory" char(42) NOT NULL,
	"fee_bps" smallint NOT NULL,
	CONSTRAINT "dexes_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "pairs" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"token_base" char(42) NOT NULL,
	"token_quote" char(42) NOT NULL,
	CONSTRAINT "pairs_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "pools" (
	"id" serial PRIMARY KEY NOT NULL,
	"dex_id" integer NOT NULL,
	"pair_id" integer NOT NULL,
	"address" char(42) NOT NULL,
	"token0" char(42) NOT NULL,
	"token1" char(42) NOT NULL,
	CONSTRAINT "pools_address_unique" UNIQUE("address"),
	CONSTRAINT "pools_dex_pair_unique" UNIQUE("dex_id","pair_id")
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"address" char(42) PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"decimals" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "windows" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"from_ts" timestamp with time zone NOT NULL,
	"to_ts" timestamp with time zone NOT NULL,
	"from_block" bigint,
	"to_block" bigint,
	CONSTRAINT "windows_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"number" bigint PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"base_fee" numeric(40, 0),
	"gas_price_median" numeric(40, 0),
	"tx_count" integer
);
--> statement-breakpoint
CREATE TABLE "ingest_ranges" (
	"pool_id" integer NOT NULL,
	"from_block" bigint NOT NULL,
	"to_block" bigint NOT NULL,
	"status" "ingest_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingest_ranges_pool_id_from_block_pk" PRIMARY KEY("pool_id","from_block")
);
--> statement-breakpoint
CREATE TABLE "swap_events" (
	"pool_id" integer NOT NULL,
	"block" bigint NOT NULL,
	"log_index" integer NOT NULL,
	"tx_hash" char(66) NOT NULL,
	"sender" char(42),
	"to" char(42),
	"amount0_in" numeric(40, 0),
	"amount0_out" numeric(40, 0),
	"amount1_in" numeric(40, 0),
	"amount1_out" numeric(40, 0),
	"gas_price" numeric(40, 0),
	CONSTRAINT "swap_events_pool_id_block_log_index_pk" PRIMARY KEY("pool_id","block","log_index")
);
--> statement-breakpoint
CREATE TABLE "sync_events" (
	"pool_id" integer NOT NULL,
	"block" bigint NOT NULL,
	"log_index" integer NOT NULL,
	"tx_hash" char(66) NOT NULL,
	"reserve0" numeric(40, 0) NOT NULL,
	"reserve1" numeric(40, 0) NOT NULL,
	CONSTRAINT "sync_events_pool_id_block_log_index_pk" PRIMARY KEY("pool_id","block","log_index")
);
--> statement-breakpoint
CREATE TABLE "block_states" (
	"pair_id" integer NOT NULL,
	"window_id" integer NOT NULL,
	"block" bigint NOT NULL,
	"price_a" double precision NOT NULL,
	"price_b" double precision NOT NULL,
	"spread_pct" double precision NOT NULL,
	"tvl_min_usd" double precision NOT NULL,
	"gas_price_median" double precision,
	"swaps_in_block" integer DEFAULT 0 NOT NULL,
	"s" double precision NOT NULL,
	"g" double precision NOT NULL,
	"l" double precision NOT NULL,
	"m" double precision NOT NULL,
	"opt_trade_usd" double precision,
	"baseline_net_profit_usd" double precision,
	"baseline_feasible" boolean,
	"direction" text DEFAULT 'none' NOT NULL,
	"gross_profit_usd" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "block_states_pair_id_block_pk" PRIMARY KEY("pair_id","block")
);
--> statement-breakpoint
CREATE TABLE "model_scores" (
	"model_id" integer NOT NULL,
	"pair_id" integer NOT NULL,
	"block" bigint NOT NULL,
	"score" double precision NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "model_scores_model_id_pair_id_block_pk" PRIMARY KEY("model_id","pair_id","block")
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair_id" integer NOT NULL,
	"window_id" integer NOT NULL,
	"block" bigint NOT NULL,
	"spread_pct" double precision NOT NULL,
	"direction" text NOT NULL,
	"est_profit_usd" double precision
);
--> statement-breakpoint
CREATE TABLE "opportunity_verifications" (
	"opportunity_id" integer PRIMARY KEY NOT NULL,
	"status" "verification_status" NOT NULL,
	"consumer_tx_hash" char(66),
	"realized_profit_usd" double precision,
	"gas_used" numeric(40, 0),
	"gas_cost_usd" double precision,
	"blocks_to_consumption" integer,
	"profitable_consumed" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoring_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "model_kind" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trained_on_window_ids" integer[],
	"metrics" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "job_type" NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"log" text DEFAULT '' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_token_base_tokens_address_fk" FOREIGN KEY ("token_base") REFERENCES "public"."tokens"("address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_token_quote_tokens_address_fk" FOREIGN KEY ("token_quote") REFERENCES "public"."tokens"("address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pools" ADD CONSTRAINT "pools_dex_id_dexes_id_fk" FOREIGN KEY ("dex_id") REFERENCES "public"."dexes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pools" ADD CONSTRAINT "pools_pair_id_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pairs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pools" ADD CONSTRAINT "pools_token0_tokens_address_fk" FOREIGN KEY ("token0") REFERENCES "public"."tokens"("address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pools" ADD CONSTRAINT "pools_token1_tokens_address_fk" FOREIGN KEY ("token1") REFERENCES "public"."tokens"("address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_ranges" ADD CONSTRAINT "ingest_ranges_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_events" ADD CONSTRAINT "swap_events_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_states" ADD CONSTRAINT "block_states_pair_id_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pairs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_states" ADD CONSTRAINT "block_states_window_id_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."windows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_scores" ADD CONSTRAINT "model_scores_model_id_scoring_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."scoring_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_scores" ADD CONSTRAINT "model_scores_pair_id_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pairs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_pair_id_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pairs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_window_id_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."windows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_verifications" ADD CONSTRAINT "opportunity_verifications_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "swap_events_block_idx" ON "swap_events" USING btree ("block");--> statement-breakpoint
CREATE INDEX "swap_events_tx_hash_idx" ON "swap_events" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "sync_events_block_idx" ON "sync_events" USING btree ("block");--> statement-breakpoint
CREATE INDEX "block_states_window_idx" ON "block_states" USING btree ("window_id","block");--> statement-breakpoint
CREATE INDEX "opportunities_pair_block_idx" ON "opportunities" USING btree ("pair_id","block");