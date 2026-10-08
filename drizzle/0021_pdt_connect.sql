CREATE TABLE "pdt_connect_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"redirect_origin" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdt_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publishing_card_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"card_row_id" uuid NOT NULL,
	"keyword" text NOT NULL,
	"intent" text NOT NULL,
	"gets" text,
	"link_id" uuid NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"state_reason" text,
	"campaign_id" uuid,
	"youtube_video_id" text,
	"armed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publishing_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"card" jsonb NOT NULL,
	"youtube_video_id" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "publishing_card_id" uuid;--> statement-breakpoint
ALTER TABLE "pdt_connect_codes" ADD CONSTRAINT "pdt_connect_codes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdt_connect_codes" ADD CONSTRAINT "pdt_connect_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdt_connections" ADD CONSTRAINT "pdt_connections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdt_connections" ADD CONSTRAINT "pdt_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_card_keywords" ADD CONSTRAINT "publishing_card_keywords_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_card_keywords" ADD CONSTRAINT "publishing_card_keywords_card_row_id_publishing_cards_id_fk" FOREIGN KEY ("card_row_id") REFERENCES "public"."publishing_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_card_keywords" ADD CONSTRAINT "publishing_card_keywords_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_cards" ADD CONSTRAINT "publishing_cards_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pdt_connect_codes_account_idx" ON "pdt_connect_codes" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pdt_connections_token_uq" ON "pdt_connections" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "pdt_connections_live_account_uq" ON "pdt_connections" USING btree ("account_id") WHERE revoked_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "publishing_card_keywords_uq" ON "publishing_card_keywords" USING btree ("card_row_id","keyword");--> statement-breakpoint
CREATE INDEX "publishing_card_keywords_video_idx" ON "publishing_card_keywords" USING btree ("account_id","youtube_video_id","keyword");--> statement-breakpoint
CREATE UNIQUE INDEX "publishing_cards_account_card_uq" ON "publishing_cards" USING btree ("account_id","card_id");--> statement-breakpoint
CREATE INDEX "publishing_cards_video_idx" ON "publishing_cards" USING btree ("account_id","youtube_video_id");