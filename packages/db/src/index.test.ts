import { describe, expect, it } from "vitest";
import { createLocalDatabase, earlyAccess } from "./index";
describe("early access persistence", () => {
  it("runs PostgreSQL migrations and deduplicates wallet and X signups", async () => {
    const { db, client } = await createLocalDatabase();
    try {
      const wallet = "So11111111111111111111111111111111111111112";
      await Promise.all(
        Array.from({ length: 5 }, () =>
          db.insert(earlyAccess).values({ wallet }).onConflictDoNothing(),
        ),
      );
      await db
        .insert(earlyAccess)
        .values({ xId: "123", xUsername: "degen" })
        .onConflictDoNothing();
      await db
        .insert(earlyAccess)
        .values({ xId: "123", xUsername: "renamed" })
        .onConflictDoNothing();
      const rows = await db.select().from(earlyAccess);
      expect(rows).toHaveLength(2);
      expect(rows[0].id).toBeTruthy();
      expect(rows[0].createdAt).toBeInstanceOf(Date);
      expect(rows.find((row) => row.wallet)?.wallet).toBe(wallet);
    } finally {
      await client.close();
    }
  });
});
