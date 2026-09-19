ALTER TABLE "pool_snapshots" ADD COLUMN "scan_before" text;--> statement-breakpoint
ALTER TABLE "pool_snapshots" ADD COLUMN "scan_head" text;--> statement-breakpoint
ALTER TABLE "pool_snapshots" ADD COLUMN "scan_started_at" timestamp with time zone;