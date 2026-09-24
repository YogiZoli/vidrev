CREATE TABLE "worker_heartbeats" (
	"id" text PRIMARY KEY NOT NULL,
	"beat_at" timestamp with time zone NOT NULL,
	"version" text NOT NULL
);
