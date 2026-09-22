CREATE TYPE "public"."verification_route" AS ENUM('two_pool', 'multi');--> statement-breakpoint
ALTER TABLE "opportunity_verifications" ADD COLUMN "route" "verification_route";--> statement-breakpoint
-- Backfill (ręcznie dopisany do wygenerowanej migracji): przed tą kolumną trasa była wyprowadzana
-- z proxy `status = 'consumed_atomic' AND realized_profit_usd IS NULL` ⇔ multi (commit 61e6c35,
-- classifyRoute w packages/analysis/src/verify/profit.ts). Statusy inne niż consumed_atomic -> NULL.
UPDATE "opportunity_verifications" SET "route" = CASE
  WHEN "status" = 'consumed_atomic' AND "realized_profit_usd" IS NULL THEN 'multi'::"public"."verification_route"
  WHEN "status" = 'consumed_atomic' THEN 'two_pool'::"public"."verification_route"
END;--> statement-breakpoint
ALTER TABLE "opportunity_verifications" ADD CONSTRAINT "opportunity_verifications_route_status_check" CHECK ("opportunity_verifications"."route" IS NULL OR "opportunity_verifications"."status" = 'consumed_atomic');--> statement-breakpoint
ALTER TABLE "opportunity_verifications" ADD CONSTRAINT "opportunity_verifications_route_multi_unprofitable_check" CHECK (NOT ("opportunity_verifications"."route" = 'multi' AND "opportunity_verifications"."profitable_consumed"));--> statement-breakpoint
COMMENT ON COLUMN "opportunity_verifications"."route" IS 'Trasa tx konsumującej (tylko consumed_atomic): two_pool = 2 swapy przez obie pule pary (zysk policzalny), multi = agregator/więcej pul (zysk nieznany, realized_profit_usd NULL, poza populacją etykiet). NULL dla pozostałych statusów.';
