CREATE TABLE "token_buyers" (
	"token_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"signature" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_buyers_token_id_wallet_pk" PRIMARY KEY("token_id","wallet")
);
--> statement-breakpoint
CREATE TABLE "token_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"body" text NOT NULL,
	"purchase_signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transaction_intents" ADD COLUMN "continuation" jsonb;--> statement-breakpoint
ALTER TABLE "transaction_intents" ADD COLUMN "continuation_result" uuid;--> statement-breakpoint
ALTER TABLE "token_buyers" ADD CONSTRAINT "token_buyers_token_id_launch_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."launch_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_comments" ADD CONSTRAINT "token_comments_token_id_launch_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."launch_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_token_time" ON "token_comments" USING btree ("token_id","created_at");