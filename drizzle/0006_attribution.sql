ALTER TABLE "accounts" ADD COLUMN "report_dirty_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "reports_computed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "net_cents" bigint;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "attribution_method" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "attributed_click_id" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "attributed_reply_id" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "attributed_campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "attributed_video_id" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "attributed_keyword" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "attributed_intent" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "attributed_touch_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "attribution_computed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "purchases_subscription_idx" ON "purchases" USING btree ("account_id","subscription_ref");--> statement-breakpoint
-- Compute attribution for existing data on the first worker tick.
UPDATE "accounts" SET "report_dirty_at" = now();