CREATE TABLE "crm_prospect_backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"contact" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"restored_at" timestamp with time zone,
	"restored_ghl_contact_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"integration_id" uuid,
	"ghl_location_id" text,
	"ghl_contact_id" text,
	"status" text DEFAULT 'creating' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"delete_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"would_delete_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_prospect_backups" ADD CONSTRAINT "crm_prospect_backups_prospect_id_crm_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."crm_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_prospect_backups" ADD CONSTRAINT "crm_prospect_backups_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_prospects" ADD CONSTRAINT "crm_prospects_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_prospects" ADD CONSTRAINT "crm_prospects_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_prospect_backups_expires_idx" ON "crm_prospect_backups" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_prospects_live_uq" ON "crm_prospects" USING btree ("account_id","contact_id") WHERE status in ('creating', 'created', 'unconfirmed');--> statement-breakpoint
CREATE UNIQUE INDEX "crm_prospects_ghl_contact_uq" ON "crm_prospects" USING btree ("ghl_location_id","ghl_contact_id");--> statement-breakpoint
CREATE INDEX "crm_prospects_due_idx" ON "crm_prospects" USING btree ("status","expires_at");