import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  real,
  boolean,
} from "drizzle-orm/pg-core";
export const earlyAccess = pgTable("early_access", {
  id: uuid("id").defaultRandom().primaryKey(),
  wallet: text("wallet").unique(),
  xId: text("x_id").unique(),
  xUsername: text("x_username"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Registry claims can be released. Historical tokens and trades are never deleted.
export const launchTokens = pgTable("launch_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  network: text("network").notNull(),
  ticker: text("ticker").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  projectLinks: jsonb("project_links").$type<{
    website?: string;
    telegram?: string;
    discord?: string;
    x?: {
      url: string;
      username: string;
      verified: boolean;
      verifiedAt?: string;
      avatar?: string | null;
    };
  }>(),
  imageId: uuid("image_id").notNull(),
  creator: text("creator").notNull(),
  quote: text("quote").notNull(),
  quoteMint: text("quote_mint"),
  quoteDecimals: integer("quote_decimals"),
  quoteCategory: text("quote_category"),
  mint: text("mint").notNull().unique(),
  pool: text("pool").notNull().unique(),
  config: text("config").notNull(),
  status: text("status").notNull().default("draft"),
  launchSignature: text("launch_signature"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  releasedAt: timestamp("released_at", { withTimezone: true }),
});
export const tickerClaims = pgTable(
  "ticker_claims",
  {
    network: text("network").notNull(),
    ticker: text("ticker").notNull(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => launchTokens.id),
    claimedAt: timestamp("claimed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.network, table.ticker] })],
);
export const tokenImages = pgTable("token_images", {
  id: uuid("id").defaultRandom().primaryKey(),
  owner: text("owner").notNull(),
  data: text("data").notNull(),
  contentType: text("content_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const walletChallenges = pgTable("wallet_challenges", {
  id: uuid("id").defaultRandom().primaryKey(),
  wallet: text("wallet").notNull(),
  message: text("message").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const walletSessions = pgTable("wallet_sessions", {
  hash: text("hash").primaryKey(),
  wallet: text("wallet").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const transactionIntents = pgTable("transaction_intents", {
  id: uuid("id").defaultRandom().primaryKey(),
  network: text("network").notNull(),
  wallet: text("wallet").notNull(),
  kind: text("kind").notNull(),
  tokenId: uuid("token_id").references(() => launchTokens.id),
  transaction: text("transaction").notNull(),
  continuation: jsonb("continuation").$type<Record<string, string | number>>(),
  continuationResult: uuid("continuation_result"),
  message: text("message").notNull(),
  blockhash: text("blockhash").notNull(),
  lastValidBlockHeight: integer("last_valid_block_height").notNull(),
  signature: text("signature").unique(),
  status: text("status").notNull().default("prepared"),
  error: text("error"),
  details: jsonb("details")
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const poolSnapshots = pgTable("pool_snapshots", {
  tokenId: uuid("token_id")
    .primaryKey()
    .references(() => launchTokens.id),
  priceQuote: text("price_quote").notNull(),
  marketCapQuote: text("market_cap_quote").notNull(),
  quoteReserve: text("quote_reserve").notNull(),
  progress: real("progress").notNull(),
  graduated: boolean("graduated").notNull().default(false),
  marketVenue: text("market_venue").notNull().default("dbc"),
  dammPool: text("damm_pool"),
  readyToMigrate: boolean("ready_to_migrate").notNull().default(false),
  creatorQuoteFee: text("creator_quote_fee").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  cursor: text("cursor"),
  lastIndexAttempt: timestamp("last_index_attempt", { withTimezone: true }),
  scanBefore: text("scan_before"),
  scanHead: text("scan_head"),
  scanStartedAt: timestamp("scan_started_at", { withTimezone: true }),
  coverageStart: timestamp("coverage_start", { withTimezone: true }),
  indexedThrough: timestamp("indexed_through", { withTimezone: true }),
});
export const tokenTrades = pgTable(
  "token_trades",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => launchTokens.id),
    signature: text("signature").notNull(),
    eventIndex: integer("event_index").notNull(),
    venue: text("venue").notNull().default("dbc"),
    wallet: text("wallet").notNull(),
    side: text("side").notNull(),
    baseAmount: text("base_amount").notNull(),
    quoteAmount: text("quote_amount").notNull(),
    priceQuote: text("price_quote").notNull(),
    volumeUsd: real("volume_usd"),
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("trade_venue_event_unique").on(
      table.signature,
      table.venue,
      table.eventIndex,
    ),
    index("trades_token_time").on(table.tokenId, table.blockTime),
  ],
);
/** DAMM has its own history boundary. DBC coverage alone cannot release a graduated ticker. */
export const graduatedIndexes = pgTable("graduated_indexes", {
  tokenId: uuid("token_id")
    .primaryKey()
    .references(() => launchTokens.id),
  pool: text("pool").notNull(),
  cursor: text("cursor"),
  scanBefore: text("scan_before"),
  scanHead: text("scan_head"),
  scanStartedAt: timestamp("scan_started_at", { withTimezone: true }),
  coverageStart: timestamp("coverage_start", { withTimezone: true }),
  indexedThrough: timestamp("indexed_through", { withTimezone: true }),
});
export const apiLimits = pgTable("api_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const tokenComments = pgTable(
  "token_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => launchTokens.id),
    wallet: text("wallet").notNull(),
    body: text("body").notNull(),
    purchaseSignature: text("purchase_signature").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("comments_token_time").on(table.tokenId, table.createdAt)],
);
export const tokenBuyers = pgTable(
  "token_buyers",
  {
    tokenId: uuid("token_id")
      .notNull()
      .references(() => launchTokens.id),
    wallet: text("wallet").notNull(),
    signature: text("signature").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.tokenId, table.wallet] })],
);

export const walletProfiles = pgTable("wallet_profiles", {
  wallet: text("wallet").primaryKey(),
  xId: text("x_id").notNull().unique(),
  xUsername: text("x_username").notNull(),
  xAvatar: text("x_avatar"),
  linkedAt: timestamp("linked_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export * from "./creator-fees-schema";
