import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { migrationsFolder, createLocalDatabase } from "./index";
if (process.env.DATABASE_URL) {
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder });
  } finally {
    await sql.end();
  }
} else {
  const { client } = await createLocalDatabase(
    process.env.PGLITE_DATA_DIR || "../../apps/web/.data/oneonly",
  );
  await client.close();
}
console.log("Database migrations applied.");
