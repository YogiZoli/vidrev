CREATE TABLE "clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tid" text NOT NULL,
	"account_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"reply_id" uuid,
	"campaign_id" uuid,
	"youtube_video_id" text,
	"keyword" text NOT NULL,
	"host" text NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"user_agent_class" text NOT NULL,
	"is_bot" boolean NOT NULL,
	"country" text,
	"referrer_host" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"cloudflare_hostname_id" text,
	"hostname_status" text,
	"ssl_status" text,
	"dns_ok" boolean DEFAULT false NOT NULL,
	"dns_target" text,
	"dns_provider" text,
	"nameservers" text[],
	"domain_connect" jsonb,
	"last_error" text,
	"checks" integer DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"host" text NOT NULL,
	"campaign_id" uuid,
	"reply_id" uuid,
	"youtube_video_id" text,
	"keyword" text NOT NULL,
	"intent" text,
	"destination_url" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "fallback_links_blocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "link_id" uuid;--> statement-breakpoint
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clicks_tid_uq" ON "clicks" USING btree ("tid");--> statement-breakpoint
CREATE INDEX "clicks_account_created_idx" ON "clicks" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "clicks_link_idx" ON "clicks" USING btree ("link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_domains_live_host_uq" ON "custom_domains" USING btree ("hostname") WHERE status <> 'removed';--> statement-breakpoint
CREATE UNIQUE INDEX "custom_domains_live_account_uq" ON "custom_domains" USING btree ("account_id") WHERE status <> 'removed';--> statement-breakpoint
CREATE UNIQUE INDEX "links_slug_uq" ON "links" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "links_reply_uq" ON "links" USING btree ("reply_id");--> statement-breakpoint
CREATE UNIQUE INDEX "links_static_uq" ON "links" USING btree ("campaign_id","youtube_video_id") WHERE kind = 'static';--> statement-breakpoint
CREATE INDEX "links_account_idx" ON "links" USING btree ("account_id");