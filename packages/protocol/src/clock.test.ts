import { expect, it, vi } from "vitest";
import {
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  type Connection,
} from "@solana/web3.js";
import { chainPoint } from "./clock";

it("uses the chain clock for slot and timestamp pools without block-history RPC", async () => {
  const data = Buffer.alloc(40);
  data.writeBigUInt64LE(447903833n, 0);
  data.writeBigInt64LE(1789682568n, 32);
  const getAccountInfo = vi
    .fn()
    .mockResolvedValue({
      data,
      owner: new PublicKey("Sysvar1111111111111111111111111111111111111"),
    });
  const rpc = { getAccountInfo } as unknown as Connection;
  expect((await chainPoint(rpc, 0)).toString()).toBe("447903833");
  expect((await chainPoint(rpc, 1)).toString()).toBe("1789682568");
  expect(getAccountInfo).toHaveBeenCalledWith(SYSVAR_CLOCK_PUBKEY, "confirmed");
});

it("fails closed on missing, malformed, or wrong-owner chain clocks", async () => {
  for (const account of [
    null,
    { data: Buffer.alloc(8) },
    { data: Buffer.alloc(40), owner: PublicKey.default },
    {
      data: Buffer.alloc(40),
      owner: new PublicKey("Sysvar1111111111111111111111111111111111111"),
    },
  ]) {
    const rpc = {
      getAccountInfo: async () => account,
    } as unknown as Connection;
    await expect(chainPoint(rpc, 1)).rejects.toThrow(/clock/);
  }
  await expect(chainPoint({} as Connection, 2)).rejects.toThrow("activation");
});
