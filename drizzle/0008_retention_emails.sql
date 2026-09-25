ALTER TABLE "accounts" ADD COLUMN "weekly_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "weekly_email_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "milestones" jsonb DEFAULT '{}'::jsonb NOT NULL;