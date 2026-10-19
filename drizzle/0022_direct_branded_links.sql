ALTER TABLE "links" ADD COLUMN "direct_tid" text;--> statement-breakpoint
CREATE UNIQUE INDEX "links_direct_tid_uq" ON "links" USING btree ("direct_tid") WHERE direct_tid is not null;