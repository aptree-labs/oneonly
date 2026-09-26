CREATE TABLE "creator_fee_allocations" (
	"token_id" uuid NOT NULL,
	"x_id" text NOT NULL,
	"share_bps" integer NOT NULL,
	CONSTRAINT "creator_fee_allocations_token_id_x_id_pk" PRIMARY KEY("token_id","x_id")
);
--> statement-breakpoint
CREATE TABLE "creator_fee_balance_snapshots" (
	"token_id" uuid NOT NULL,
	"x_id" text NOT NULL,
	"balances" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observed_at" timestamp with time zone,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_fee_balance_snapshots_token_id_x_id_pk" PRIMARY KEY("token_id","x_id")
);
--> statement-breakpoint
CREATE TABLE "creator_fee_bindings" (
	"network" text NOT NULL,
	"x_id" text NOT NULL,
	"wallet" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_fee_bindings_network_x_id_pk" PRIMARY KEY("network","x_id")
);
--> statement-breakpoint
CREATE TABLE "creator_fee_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"network" text NOT NULL,
	"x_id" text NOT NULL,
	"wallet" text NOT NULL,
	"binding_version" integer NOT NULL,
	"token_id" uuid NOT NULL,
	"mint" text NOT NULL,
	"amount_atomic" text NOT NULL,
	"cumulative_atomic" text NOT NULL,
	"program" text NOT NULL,
	"escrow" text NOT NULL,
	"code" text NOT NULL,
	"scope_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tweet_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"confirmed_signature" text,
	CONSTRAINT "creator_fee_challenges_code_unique" UNIQUE("code"),
	CONSTRAINT "creator_fee_challenges_tweet_id_unique" UNIQUE("tweet_id"),
	CONSTRAINT "creator_fee_challenges_confirmed_signature_unique" UNIQUE("confirmed_signature")
);
--> statement-breakpoint
CREATE TABLE "creator_fee_pools" (
	"token_id" uuid PRIMARY KEY NOT NULL,
	"network" text NOT NULL,
	"pool" text NOT NULL,
	"mint" text NOT NULL,
	"escrow" text NOT NULL,
	"program" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_fee_profiles" (
	"x_id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"name" text NOT NULL,
	"avatar" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creator_fee_allocations" ADD CONSTRAINT "creator_fee_allocations_token_id_creator_fee_pools_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."creator_fee_pools"("token_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_fee_allocations" ADD CONSTRAINT "creator_fee_allocations_x_id_creator_fee_profiles_x_id_fk" FOREIGN KEY ("x_id") REFERENCES "public"."creator_fee_profiles"("x_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_fee_balance_snapshots" ADD CONSTRAINT "creator_fee_balance_snapshots_token_id_creator_fee_pools_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."creator_fee_pools"("token_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_fee_balance_snapshots" ADD CONSTRAINT "creator_fee_balance_snapshots_x_id_creator_fee_profiles_x_id_fk" FOREIGN KEY ("x_id") REFERENCES "public"."creator_fee_profiles"("x_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_fee_challenges" ADD CONSTRAINT "creator_fee_challenges_token_id_creator_fee_pools_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."creator_fee_pools"("token_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_fee_recipient_tokens" ON "creator_fee_allocations" USING btree ("x_id","token_id");--> statement-breakpoint
CREATE INDEX "creator_fee_snapshot_recipient" ON "creator_fee_balance_snapshots" USING btree ("x_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_fee_binding_wallet" ON "creator_fee_bindings" USING btree ("network","wallet");--> statement-breakpoint
CREATE INDEX "creator_fee_wallet_challenges" ON "creator_fee_challenges" USING btree ("network","wallet","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_fee_pool_network" ON "creator_fee_pools" USING btree ("network","pool");