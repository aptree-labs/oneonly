CREATE TABLE "early_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text,
	"x_id" text,
	"x_username" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "early_access_wallet_unique" UNIQUE("wallet"),
	CONSTRAINT "early_access_x_id_unique" UNIQUE("x_id")
);
