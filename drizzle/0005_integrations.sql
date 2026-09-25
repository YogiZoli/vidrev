CREATE TABLE "inbound_hook_secrets" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"token_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"type" text NOT NULL,
	"label" text,
	"config_enc" text,
	"status" text DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"events" text[],
	"external_ref" text,
	"sync_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_sync_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outbound_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response_status" integer,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"source" text NOT NULL,
	"kind" text DEFAULT 'payment' NOT NULL,
	"external_id" text NOT NULL,
	"email_norm" text,
	"tid" text,
	"amount_cents" bigint,
	"currency" text,
	"refunded_cents" bigint DEFAULT 0 NOT NULL,
	"subscription_ref" text,
	"ghl_contact_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"canonical_purchase_id" uuid,
	"attributed_subscriber_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"email_norm" text NOT NULL,
	"name" text,
	"source" text NOT NULL,
	"external_id" text,
	"dedupe_key" text NOT NULL,
	"tid" text,
	"click_id" uuid,
	"link_id" uuid,
	"reply_id" uuid,
	"campaign_id" uuid,
	"youtube_video_id" text,
	"keyword" text,
	"consent_marketing" boolean,
	"ghl_contact_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbound_hook_secrets" ADD CONSTRAINT "inbound_hook_secrets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_deliveries" ADD CONSTRAINT "outbound_deliveries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_deliveries" ADD CONSTRAINT "outbound_deliveries_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_hook_secrets_hash_uq" ON "inbound_hook_secrets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "integrations_account_idx" ON "integrations" USING btree ("account_id","type");--> statement-breakpoint
CREATE INDEX "integrations_next_sync_idx" ON "integrations" USING btree ("next_sync_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_live_ref_uq" ON "integrations" USING btree ("type","external_ref") WHERE status <> 'removed' and external_ref is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_deliveries_event_uq" ON "outbound_deliveries" USING btree ("integration_id","event_id");--> statement-breakpoint
CREATE INDEX "outbound_deliveries_due_idx" ON "outbound_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "outbound_deliveries_integration_idx" ON "outbound_deliveries" USING btree ("integration_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_source_external_uq" ON "purchases" USING btree ("account_id","source","external_id");--> statement-breakpoint
CREATE INDEX "purchases_account_email_idx" ON "purchases" USING btree ("account_id","email_norm");--> statement-breakpoint
CREATE INDEX "purchases_account_occurred_idx" ON "purchases" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "purchases_tid_idx" ON "purchases" USING btree ("tid");--> statement-breakpoint
CREATE UNIQUE INDEX "subscribers_touch_uq" ON "subscribers" USING btree ("account_id","source","email_norm","dedupe_key");--> statement-breakpoint
CREATE INDEX "subscribers_account_email_idx" ON "subscribers" USING btree ("account_id","email_norm");--> statement-breakpoint
CREATE INDEX "subscribers_account_occurred_idx" ON "subscribers" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "subscribers_tid_idx" ON "subscribers" USING btree ("tid");