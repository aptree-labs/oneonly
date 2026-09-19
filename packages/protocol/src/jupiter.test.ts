import { expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import fixture from "./fixtures/mainnet-jupiter-stock-route.json";
import shared from "./fixtures/mainnet-jupiter-jup-shared-route.json";
import { validateJupiterRoute } from "./jupiter";
const request = {
  wallet: fixture.swapInstruction.accounts[0].pubkey,
  inputMint: fixture.inputMint,
  outputMint: fixture.outputMint,
  amount: BigInt(fixture.inAmount),
  slippageBps: fixture.slippageBps,
  inputProgram: TOKEN_PROGRAM_ID,
  outputProgram: TOKEN_2022_PROGRAM_ID,
};
it("accepts the captured unsigned mainnet route and preserves its minimum", () => {
  const route = validateJupiterRoute(fixture, request);
  expect(route.minimumOut).toBe(BigInt(fixture.otherAmountThreshold));
});

const sharedRequest = {
  wallet: shared.swapInstruction.accounts[1].pubkey,
  inputMint: shared.inputMint,
  outputMint: shared.outputMint,
  amount: BigInt(shared.inAmount),
  slippageBps: shared.slippageBps,
  inputProgram: TOKEN_PROGRAM_ID,
  outputProgram: TOKEN_PROGRAM_ID,
};
it("accepts the real JUP shared-account route with verified Jupiter PDAs and wallet endpoints", () => {
  expect(validateJupiterRoute(shared, sharedRequest).minimumOut).toBe(
    BigInt(shared.otherAmountThreshold),
  );
});
it("rejects shared-route account substitutions, extra fees and changed byte-level limits", () => {
  for (let index = 0; index < 12; index++) {
    const changed = structuredClone(shared);
    changed.swapInstruction.accounts[index].pubkey =
      PublicKey.default.toBase58();
    expect(() => validateJupiterRoute(changed, sharedRequest)).toThrow();
  }
  for (const offset of [8, 9, 17, 25, 27, 29]) {
    const changed = structuredClone(shared);
    const bytes = Buffer.from(changed.swapInstruction.data, "base64");
    bytes[offset] ^= 1;
    changed.swapInstruction.data = bytes.toString("base64");
    expect(() => validateJupiterRoute(changed, sharedRequest)).toThrow();
  }
});
it("rejects altered mint, amount, slippage and unrelated transfers", () => {
  for (const change of [
    { inputMint: PublicKey.default.toBase58() },
    { inAmount: "1" },
    { slippageBps: 500 },
    { otherAmountThreshold: "1" },
  ])
    expect(() =>
      validateJupiterRoute({ ...fixture, ...change }, request),
    ).toThrow();
  const changed = structuredClone(fixture);
  changed.setupInstructions[1].accounts[1].pubkey =
    PublicKey.default.toBase58();
  expect(() => validateJupiterRoute(changed, request)).toThrow();
  const instruction = structuredClone(fixture);
  const bytes = Buffer.from(instruction.swapInstruction.data, "base64");
  bytes.writeBigUInt64LE(1n, 8);
  instruction.swapInstruction.data = bytes.toString("base64");
  expect(() => validateJupiterRoute(instruction, request)).toThrow();
});
