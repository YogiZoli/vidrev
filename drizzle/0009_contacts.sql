CREATE TABLE "contact_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"source" text NOT NULL,
	"channel_id" uuid,
	"ref_comment_id" text,
	"refresh_due_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"winner_id" uuid NOT NULL,
	"loser_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"moved" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"stage" text DEFAULT 'commenter' NOT NULL,
	"primary_email_norm" text,
	"display_name" text,
	"created_via" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"first_comment_seen_at" timestamp with time zone,
	"subscribed_at" timestamp with time zone,
	"first_purchase_at" timestamp with time zone,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clicks" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merges" ADD CONSTRAINT "contact_merges_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identities_key_uq" ON "contact_identities" USING btree ("account_id","kind","value");--> statement-breakpoint
CREATE INDEX "contact_identities_contact_idx" ON "contact_identities" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_identities_refresh_idx" ON "contact_identities" USING btree ("kind","refresh_due_at");--> statement-breakpoint
CREATE INDEX "contact_merges_winner_idx" ON "contact_merges" USING btree ("account_id","winner_id");--> statement-breakpoint
CREATE INDEX "contacts_account_idx" ON "contacts" USING btree ("account_id","first_seen_at");--> statement-breakpoint
CREATE INDEX "contacts_account_stage_idx" ON "contacts" USING btree ("account_id","stage");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("account_id","primary_email_norm");--> statement-breakpoint
CREATE INDEX "clicks_contact_idx" ON "clicks" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "purchases_contact_idx" ON "purchases" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "replies_contact_idx" ON "replies" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "subscribers_contact_idx" ON "subscribers" USING btree ("contact_id");