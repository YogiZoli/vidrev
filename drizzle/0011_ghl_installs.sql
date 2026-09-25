CREATE TABLE "ghl_installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"claim_hash" text NOT NULL,
	"config_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ghl_installs_claim_uq" ON "ghl_installs" USING btree ("claim_hash");--> statement-breakpoint
CREATE INDEX "ghl_installs_location_idx" ON "ghl_installs" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "ghl_installs_expires_idx" ON "ghl_installs" USING btree ("expires_at");