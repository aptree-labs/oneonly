import postgres from "../packages/db/node_modules/postgres";
import { drizzle } from "../packages/db/node_modules/drizzle-orm/postgres-js";
import { migrate } from "../packages/db/node_modules/drizzle-orm/postgres-js/migrator";
import { resolve } from "node:path";
async function main() {
  const url = process.env.MAINNET_DATABASE_URL;
  if (
    process.env.SOLANA_NETWORK !== "mainnet-beta" ||
    !url ||
    new URL(url).pathname !== "/oneonly_mainnet"
  )
    throw new Error("Unexpected migration target");
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    connection: { lock_timeout: 5000, statement_timeout: 30000 },
  });
  try {
    await migrate(drizzle(sql), {
      migrationsFolder: resolve("../../packages/db/drizzle"),
    });
    const [tables] =
      await sql`select to_regclass('public.token_comments') is not null as comments, to_regclass('public.token_buyers') is not null as buyers`;
    console.log(
      JSON.stringify({
        database: "oneonly_mainnet",
        migration: "0006",
        ...tables,
      }),
    );
  } finally {
    await sql.end();
  }
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      error: "Migration failed",
      code: error?.code,
      type: error?.name,
    }),
  );
  process.exitCode = 1;
});
