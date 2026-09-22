CREATE TYPE "public"."direction_kind" AS ENUM('none', 'a_to_b', 'b_to_a');--> statement-breakpoint
CREATE TYPE "public"."feasibility_label" AS ENUM('niewykonalna', 'ryzykowna', 'wykonalna', 'atrakcyjna');--> statement-breakpoint
ALTER TABLE "block_states" ALTER COLUMN "direction" SET DEFAULT 'none'::"public"."direction_kind";--> statement-breakpoint
ALTER TABLE "block_states" ALTER COLUMN "direction" SET DATA TYPE "public"."direction_kind" USING "direction"::"public"."direction_kind";--> statement-breakpoint
ALTER TABLE "model_scores" ALTER COLUMN "label" SET DATA TYPE "public"."feasibility_label" USING "label"::"public"."feasibility_label";--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "direction" SET DATA TYPE "public"."direction_kind" USING "direction"::"public"."direction_kind";--> statement-breakpoint
ALTER TABLE "scoring_models" ADD CONSTRAINT "scoring_models_name_version_unique" UNIQUE("name","version");--> statement-breakpoint
COMMENT ON TABLE "block_states" IS 'Stan pary WETH/USDC po każdym bloku okna: A = pula na Uniswap V2, B = pula na Sushiswap.';--> statement-breakpoint
COMMENT ON COLUMN "block_states"."gas_price_median" IS 'Mediana ceny gazu bloku w GWEI (double precision) — w przeciwieństwie do blocks.gas_price_median, które jest w WEI (numeric).';--> statement-breakpoint
COMMENT ON COLUMN "blocks"."gas_price_median" IS 'Mediana ceny gazu bloku w WEI (numeric) — przelicznik do GWEI przy wczytywaniu, patrz packages/analysis/src/loadInputs.ts.';