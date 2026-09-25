CREATE TABLE "report_snapshots" (
	"account_id" uuid NOT NULL,
	"period" text NOT NULL,
	"data" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "report_snapshots_account_id_period_pk" PRIMARY KEY("account_id","period")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "reporting_currency_source" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "report_timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "price_cents" bigint;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "price_currency" text;--> statement-breakpoint
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Seeding never overwrites plan rows, so the founding price is set here.
UPDATE "plans" SET "price_cents" = 9700, "price_currency" = 'USD' WHERE "code" = 'founding' AND "price_cents" IS NULL;--> statement-breakpoint
UPDATE "accounts" SET "report_dirty_at" = now();