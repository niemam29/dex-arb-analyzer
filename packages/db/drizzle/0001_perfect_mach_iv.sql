DROP INDEX "opportunities_pair_block_idx";--> statement-breakpoint
ALTER TABLE "ingest_ranges" DROP CONSTRAINT "ingest_ranges_pool_id_from_block_pk";--> statement-breakpoint
ALTER TABLE "ingest_ranges" ADD CONSTRAINT "ingest_ranges_pool_id_from_block_to_block_pk" PRIMARY KEY("pool_id","from_block","to_block");--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_pair_block_unique" UNIQUE("pair_id","block");