CREATE TABLE "api_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "launch_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network" text NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"image_id" uuid NOT NULL,
	"creator" text NOT NULL,
	"quote" text NOT NULL,
	"mint" text NOT NULL,
	"pool" text NOT NULL,
	"config" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"launch_signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	CONSTRAINT "launch_tokens_mint_unique" UNIQUE("mint"),
	CONSTRAINT "launch_tokens_pool_unique" UNIQUE("pool")
);
--> statement-breakpoint
CREATE TABLE "pool_snapshots" (
	"token_id" uuid PRIMARY KEY NOT NULL,
	"price_quote" text NOT NULL,
	"market_cap_quote" text NOT NULL,
	"quote_reserve" text NOT NULL,
	"progress" real NOT NULL,
	"graduated" boolean DEFAULT false NOT NULL,
	"creator_quote_fee" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cursor" text,
	"coverage_start" timestamp with time zone,
	"indexed_through" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ticker_claims" (
	"network" text NOT NULL,
	"ticker" text NOT NULL,
	"token_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticker_claims_network_ticker_pk" PRIMARY KEY("network","ticker")
);
--> statement-breakpoint
CREATE TABLE "token_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"data" text NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid NOT NULL,
	"signature" text NOT NULL,
	"event_index" integer NOT NULL,
	"wallet" text NOT NULL,
	"side" text NOT NULL,
	"base_amount" text NOT NULL,
	"quote_amount" text NOT NULL,
	"price_quote" text NOT NULL,
	"volume_usd" real,
	"block_time" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network" text NOT NULL,
	"wallet" text NOT NULL,
	"kind" text NOT NULL,
	"token_id" uuid,
	"transaction" text NOT NULL,
	"message" text NOT NULL,
	"blockhash" text NOT NULL,
	"last_valid_block_height" integer NOT NULL,
	"signature" text,
	"status" text DEFAULT 'prepared' NOT NULL,
	"error" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_intents_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "wallet_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_sessions" (
	"hash" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pool_snapshots" ADD CONSTRAINT "pool_snapshots_token_id_launch_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."launch_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticker_claims" ADD CONSTRAINT "ticker_claims_token_id_launch_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."launch_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_trades" ADD CONSTRAINT "token_trades_token_id_launch_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."launch_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_intents" ADD CONSTRAINT "transaction_intents_token_id_launch_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."launch_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_event_unique" ON "token_trades" USING btree ("signature","event_index");--> statement-breakpoint
CREATE INDEX "trades_token_time" ON "token_trades" USING btree ("token_id","block_time");