CREATE TABLE "wallet_profiles" (
	"wallet" text PRIMARY KEY NOT NULL,
	"x_id" text NOT NULL,
	"x_username" text NOT NULL,
	"x_avatar" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_profiles_x_id_unique" UNIQUE("x_id")
);
