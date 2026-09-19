import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDatabase, apiLimits, eq } from "../packages/db/src/index";
import { rateLimit } from "../apps/web/src/lib/launchpad/auth";
async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error("Set DATABASE_URL to an isolated test database.");
  const key = `postgres-check:${randomUUID()}`,
    db = await getDatabase();
  try {
    await rateLimit(key, 2);
    await rateLimit(key, 2);
    await assert.rejects(
      () => rateLimit(key, 2),
      (error) => (error as { status: number }).status === 429,
    );
    await db
      .update(apiLimits)
      .set({ expiresAt: new Date(0) })
      .where(eq(apiLimits.key, key));
    await rateLimit(key, 2);
    const [row] = await db
      .select()
      .from(apiLimits)
      .where(eq(apiLimits.key, key));
    assert.equal(row.count, 1);
    console.log(
      "PostgreSQL rate-limit increments, rejection, and expiry reset passed.",
    );
  } finally {
    await db.delete(apiLimits).where(eq(apiLimits.key, key));
  }
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
