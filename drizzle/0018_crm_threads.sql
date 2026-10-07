ALTER TABLE "crm_prospects" ADD COLUMN "ghl_conversation_id" text;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "crm_threaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "crm_message_id" text;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "crm_status_sent_at" timestamp with time zone;