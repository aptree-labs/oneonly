import { runtimeDatabaseUrl } from "./connection-options";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as postgresDrizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import * as schema from "./schema";
export * from "./schema";
export {
  and,
  eq,
  gt,
  gte,
  lt,
  lte,
  desc,
  asc,
  sql,
  inArray,
  isNull,
} from "drizzle-orm";

const migrationPaths = [
  process.env.DRIZZLE_MIGRATIONS_DIR,
  "./drizzle",
  "./packages/db/drizzle",
  "../../packages/db/drizzle",
]
  .filter((path): path is string => !!path)
  .map((path) => resolve(path));
export const migrationsFolder =
  migrationPaths.find((path) =>
    existsSync(resolve(path, "meta/_journal.json")),
  ) ?? migrationPaths[0];
export async function createLocalDatabase(dataDir?: string) {
  if (dataDir) await mkdir(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = pgliteDrizzle(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return { db, client };
}
async function connect() {
  const databaseUrl =
    process.env.SOLANA_NETWORK === "mainnet-beta"
      ? process.env.MAINNET_DATABASE_URL
      : process.env.DATABASE_URL;
  if (process.env.SOLANA_NETWORK === "mainnet-beta") {
    const url = databaseUrl;
    if (!url || new URL(url).pathname !== "/oneonly_mainnet")
      throw new Error(
        "Mainnet requires the isolated oneonly_mainnet database.",
      );
  }
  if (databaseUrl)
    return postgresDrizzle(
      postgres(runtimeDatabaseUrl(databaseUrl), {
        max: 5,
        prepare: false,
        connect_timeout: 10,
        idle_timeout: 20,
        max_lifetime: 1800,
      }),
      {
        schema,
      },
    );
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_PGLITE !== "true"
  ) {
    throw new Error(
      "DATABASE_URL is required in production. For a local production preview, set ALLOW_PGLITE=true.",
    );
  }
  return (
    await createLocalDatabase(process.env.PGLITE_DATA_DIR || ".data/oneonly")
  ).db;
}
export type Database = Awaited<ReturnType<typeof connect>>;
export * from "./market";
export * from "./office";
export * from "./leaderboard";
const globalDb = globalThis as unknown as { oneonlyDb?: Promise<Database> };
export function getDatabase() {
  globalDb.oneonlyDb ??= connect().catch((error) => {
    delete globalDb.oneonlyDb;
    throw error;
  });
  return globalDb.oneonlyDb;
}
export async function saveSignup(
  value: { wallet: string } | { xId: string; xUsername: string },
) {
  const db = await getDatabase();
  await db.insert(schema.earlyAccess).values(value).onConflictDoNothing();
}
