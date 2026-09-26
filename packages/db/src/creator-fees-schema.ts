import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  uuid,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
export const creatorFeeProfiles = pgTable("creator_fee_profiles", {
  xId: text("x_id").primaryKey(),
  username: text("username").notNull(),
  name: text("name").notNull(),
  avatar: text("avatar"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const creatorFeeBindings = pgTable(
  "creator_fee_bindings",
  {
    network: text("network").notNull(),
    xId: text("x_id").notNull(),
    wallet: text("wallet").notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.network, t.xId] }),
    uniqueIndex("creator_fee_binding_wallet").on(t.network, t.wallet),
  ],
);
export const creatorFeePools = pgTable(
  "creator_fee_pools",
  {
    tokenId: uuid("token_id").primaryKey(),
    network: text("network").notNull(),
    pool: text("pool").notNull(),
    mint: text("mint").notNull(),
    escrow: text("escrow").notNull(),
    program: text("program").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("creator_fee_pool_network").on(t.network, t.pool)],
);
export const creatorFeeAllocations = pgTable(
  "creator_fee_allocations",
  {
    tokenId: uuid("token_id")
      .notNull()
      .references(() => creatorFeePools.tokenId),
    xId: text("x_id")
      .notNull()
      .references(() => creatorFeeProfiles.xId),
    shareBps: integer("share_bps").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tokenId, t.xId] }),
    index("creator_fee_recipient_tokens").on(t.xId, t.tokenId),
  ],
);
export const creatorFeeChallenges = pgTable(
  "creator_fee_challenges",
  {
    id: uuid("id").primaryKey(),
    network: text("network").notNull(),
    xId: text("x_id").notNull(),
    wallet: text("wallet").notNull(),
    bindingVersion: integer("binding_version").notNull(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => creatorFeePools.tokenId),
    mint: text("mint").notNull(),
    amountAtomic: text("amount_atomic").notNull(),
    cumulativeAtomic: text("cumulative_atomic").notNull(),
    program: text("program").notNull(),
    escrow: text("escrow").notNull(),
    code: text("code").notNull().unique(),
    scopeHash: text("scope_hash").notNull(),
    status: text("status").default("pending").notNull(),
    tweetId: text("tweet_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    confirmedSignature: text("confirmed_signature").unique(),
  },
  (t) => [
    index("creator_fee_wallet_challenges").on(t.network, t.wallet, t.createdAt),
  ],
);

/** Display projection only; never authorizes a withdrawal. */
export const creatorFeeBalanceSnapshots = pgTable(
  "creator_fee_balance_snapshots",
  {
    tokenId: uuid("token_id")
      .notNull()
      .references(() => creatorFeePools.tokenId),
    xId: text("x_id")
      .notNull()
      .references(() => creatorFeeProfiles.xId),
    balances: jsonb("balances")
      .$type<
        Array<{
          mint: string;
          symbol: string;
          decimals: number;
          amountAtomic: string;
          pendingAtomic: string;
          claimedAtomic: string;
          totalEntitlementAtomic: string;
          pendingVenue: "dbc" | "damm-v2";
        }>
      >()
      .notNull()
      .default([]),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tokenId, t.xId] }),
    index("creator_fee_snapshot_recipient").on(t.xId),
  ],
);
