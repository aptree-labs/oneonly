import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createLocalDatabase, launchTokens, tickerClaims, eq } from "./index";
it("allows one current claim, then releases the name while retaining its token history", async () => {
  const { db, client } = await createLocalDatabase();
  try {
    const tokens = Array.from({ length: 2 }, (_, i) => ({
      id: randomUUID(),
      network: "devnet",
      ticker: "ONLY",
      name: "Test",
      description: "Registry test",
      imageId: randomUUID(),
      creator: "wallet",
      quote: "SOL",
      mint: `mint-${i}`,
      pool: `pool-${i}`,
      config: "config",
      status: "active",
    }));
    await db.insert(launchTokens).values(tokens);
    const results = await Promise.all(
      tokens.map((token) =>
        db
          .insert(tickerClaims)
          .values({ network: "devnet", ticker: "ONLY", tokenId: token.id })
          .onConflictDoNothing()
          .returning(),
      ),
    );
    expect(results.flat()).toHaveLength(1);
    const winner = results.flat()[0];
    await db.transaction(async (tx) => {
      await tx
        .delete(tickerClaims)
        .where(eq(tickerClaims.tokenId, winner.tokenId));
      await tx
        .update(launchTokens)
        .set({ status: "released", releasedAt: new Date() })
        .where(eq(launchTokens.id, winner.tokenId));
    });
    const next = tokens.find((token) => token.id !== winner.tokenId)!;
    await db
      .insert(tickerClaims)
      .values({ network: "devnet", ticker: "ONLY", tokenId: next.id });
    expect(await db.select().from(launchTokens)).toHaveLength(2);
    expect((await db.select().from(tickerClaims))[0].tokenId).toBe(next.id);
    // A stale release job cannot delete the next owner's claim.
    expect(
      await db
        .delete(tickerClaims)
        .where(eq(tickerClaims.tokenId, winner.tokenId))
        .returning(),
    ).toHaveLength(0);
  } finally {
    await client.close();
  }
});
