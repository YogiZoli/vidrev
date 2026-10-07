ALTER TABLE "crm_prospects" ADD COLUMN "merged_into_ghl_contact_id" text;--> statement-breakpoint
ALTER TABLE "crm_prospects" ADD COLUMN "merge_copied_at" timestamp with time zone;