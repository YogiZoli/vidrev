ALTER TABLE "accounts" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "purchase_source" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "default_target_url" text;