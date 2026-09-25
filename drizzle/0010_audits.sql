CREATE TABLE "audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_key" text NOT NULL,
	"channel_input" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"failure_reason" text,
	"youtube_channel_id" text,
	"result" jsonb,
	"examples" jsonb,
	"fetched_at" timestamp with time zone,
	"api_data_scrubbed_at" timestamp with time zone,
	"requester_email" text,
	"consent_marketing" boolean,
	"consent_at" timestamp with time zone,
	"report_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audits_channel_idx" ON "audits" USING btree ("channel_key","created_at");--> statement-breakpoint
CREATE INDEX "audits_email_idx" ON "audits" USING btree ("requester_email","report_sent_at");--> statement-breakpoint
CREATE INDEX "audits_fetched_idx" ON "audits" USING btree ("fetched_at");