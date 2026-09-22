ALTER TABLE "opportunity_verifications" DROP CONSTRAINT "opportunity_verifications_opportunity_id_opportunities_id_fk";
--> statement-breakpoint
ALTER TABLE "opportunity_verifications" ADD CONSTRAINT "opportunity_verifications_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;