CREATE TABLE "graduated_indexes" (
	"token_id" uuid PRIMARY KEY NOT NULL,
	"pool" text NOT NULL,
	"cursor" text,
	"scan_before" text,
	"scan_head" text,
	"scan_started_at" timestamp with time zone,
	"coverage_start" timestamp with time zone,
	"indexed_through" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "trade_event_unique";--> statement-breakpoint
ALTER TABLE "pool_snapshots" ADD COLUMN "market_venue" text DEFAULT 'dbc' NOT NULL;--> statement-breakpoint
ALTER TABLE "pool_snapshots" ADD COLUMN "damm_pool" text;--> statement-breakpoint
ALTER TABLE "pool_snapshots" ADD COLUMN "ready_to_migrate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "token_trades" ADD COLUMN "venue" text DEFAULT 'dbc' NOT NULL;--> statement-breakpoint
ALTER TABLE "graduated_indexes" ADD CONSTRAINT "graduated_indexes_token_id_launch_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."launch_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_venue_event_unique" ON "token_trades" USING btree ("signature","venue","event_index");