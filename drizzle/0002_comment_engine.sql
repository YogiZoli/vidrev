CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"keyword" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"intent" text DEFAULT 'warm' NOT NULL,
	"destination_url" text NOT NULL,
	"video_ids" text[],
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"youtube_comment_id" text NOT NULL,
	"youtube_video_id" text NOT NULL,
	"author_channel_id" text,
	"author_name" text,
	"text" text NOT NULL,
	"language" text,
	"published_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"comment_id" uuid,
	"campaign_id" uuid,
	"template_id" uuid,
	"youtube_video_id" text NOT NULL,
	"keyword" text NOT NULL,
	"intent" text NOT NULL,
	"other_matches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"language" text NOT NULL,
	"body" text NOT NULL,
	"draft_source" text NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"status_reason" text,
	"approved_at" timestamp with time zone,
	"queued_for_date_pt" date,
	"sent_at" timestamp with time zone,
	"youtube_reply_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"language" text NOT NULL,
	"body" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"youtube_video_id" text NOT NULL,
	"title" text,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "ai_provider" text DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "ai_key_enc" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "ai_model" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "drafts_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "next_poll_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "last_polled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "comment_cursor" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "fresh_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "last_upload_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "websub_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "rss_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_channel_idx" ON "campaigns" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "campaigns_account_idx" ON "campaigns" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comments_youtube_uq" ON "comments" USING btree ("youtube_comment_id");--> statement-breakpoint
CREATE INDEX "comments_fetched_idx" ON "comments" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "replies_account_status_idx" ON "replies" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "replies_status_idx" ON "replies" USING btree ("status","queued_for_date_pt");--> statement-breakpoint
CREATE UNIQUE INDEX "replies_comment_uq" ON "replies" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "templates_campaign_idx" ON "templates" USING btree ("campaign_id","language");--> statement-breakpoint
CREATE UNIQUE INDEX "videos_channel_video_uq" ON "videos" USING btree ("channel_id","youtube_video_id");--> statement-breakpoint
CREATE INDEX "channels_next_poll_idx" ON "channels" USING btree ("next_poll_at");