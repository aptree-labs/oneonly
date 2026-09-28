import { expect, it, vi } from "vitest";
import {
  Keypair,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import { validateLaunchSimulation } from "./launch-simulation";
const payer = Keypair.generate();
const tx = new Transaction({
  feePayer: payer.publicKey,
  recentBlockhash: Keypair.generate().publicKey.toBase58(),
}).add(
  SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: Keypair.generate().publicKey,
    lamports: 1,
  }),
);
const wire = tx.serialize({ requireAllSignatures: false }).toString("base64");
const insufficient = {
  err: { InstructionError: [2, { Custom: 1 }] },
  logs: ["Transfer: insufficient lamports 988600, need 1838960"],
};
it("recognizes the funded ANDY rejection as insufficient rent, not expiry", async () => {
  const simulateTransaction = vi
    .fn()
    .mockResolvedValue({ value: insufficient });
  await expect(
    validateLaunchSimulation(
      { simulateTransaction } as unknown as Connection,
      wire,
    ),
  ).rejects.toMatchObject({
    status: 400,
    message: expect.stringContaining("Not enough SOL for creation rent"),
  });
  expect(simulateTransaction.mock.calls[0][1]).toEqual({
    commitment: "confirmed",
    sigVerify: false,
  });
});
it("permits a successfully simulated launch without broadcasting", async () => {
  const simulateTransaction = vi
    .fn()
    .mockResolvedValue({ value: { err: null, logs: [] } });
  await expect(
    validateLaunchSimulation(
      { simulateTransaction } as unknown as Connection,
      wire,
    ),
  ).resolves.toBeUndefined();
});
it("does not confuse program failures with a funding error or expose raw logs", async () => {
  const simulateTransaction = vi
    .fn()
    .mockResolvedValue({
      value: {
        err: { InstructionError: [3, { Custom: 99 }] },
        logs: ["internal diagnostic"],
      },
    });
  await expect(
    validateLaunchSimulation(
      { simulateTransaction } as unknown as Connection,
      wire,
    ),
  ).rejects.toMatchObject({
    status: 400,
    message:
      "This launch failed its network check. Nothing was sent. Please try again or contact support.",
  });
});
