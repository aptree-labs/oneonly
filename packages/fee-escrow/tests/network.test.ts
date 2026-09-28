import { expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  FEE_ESCROW_PROGRAM,
  MAINNET_FEE_ESCROW_PROGRAM,
  CLAIM_DOMAIN,
  feeEscrowProgram,
  feeEscrowClaimDomain,
  assertFeeEscrowProgram,
  claimMessage,
  claimInstructions,
  allocationAddress,
  xIdHash,
} from "../src";
const wallet = Keypair.generate().publicKey,
  pool = Keypair.generate().publicKey;
const claim = {
  xIdHash: xIdHash("12345"),
  cumulativeLimit: 100n,
  bindingVersion: 1n,
  verifierEpoch: 1n,
  nonce: Buffer.alloc(32, 4),
  issuedAt: 1000n,
  expiresAt: 1100n,
};
const destination = getAssociatedTokenAddressSync(NATIVE_MINT, wallet);
it("preserves devnet defaults and pins distinct network deployments/domains", () => {
  expect(feeEscrowProgram("devnet")).toEqual(FEE_ESCROW_PROGRAM);
  expect(feeEscrowProgram("mainnet-beta")).toEqual(MAINNET_FEE_ESCROW_PROGRAM);
  expect(CLAIM_DOMAIN.toString()).toBe("oneonly:fee:v2:devnet");
  expect(feeEscrowClaimDomain("mainnet-beta").toString()).toBe(
    "oneonly:fee:v2:mainnet-beta",
  );
  expect(() => feeEscrowProgram("testnet" as never)).toThrow("Unsupported");
  expect(() =>
    assertFeeEscrowProgram("devnet", MAINNET_FEE_ESCROW_PROGRAM),
  ).toThrow("does not match");
  expect(() =>
    assertFeeEscrowProgram("mainnet-beta", FEE_ESCROW_PROGRAM),
  ).toThrow("does not match");
  expect(() =>
    assertFeeEscrowProgram("mainnet-beta", Keypair.generate().publicKey),
  ).toThrow("does not match");
});
it("binds every signed claim field to its exact mainnet domain/program and matching instruction PDA", () => {
  const program = feeEscrowProgram("mainnet-beta");
  const allocation = allocationAddress(pool, program);
  const message = claimMessage(
    claim,
    allocation,
    NATIVE_MINT,
    wallet,
    destination,
    program,
    "mainnet-beta",
  );
  const domain = feeEscrowClaimDomain("mainnet-beta");
  expect(message.subarray(0, domain.length)).toEqual(domain);
  expect(message.subarray(domain.length, domain.length + 32)).toEqual(
    program.toBuffer(),
  );
  const [verify, instruction] = claimInstructions({
    claim,
    pool,
    mint: NATIVE_MINT,
    wallet,
    tokenProgram: TOKEN_PROGRAM_ID,
    verifier: Keypair.generate().publicKey,
    signature: Buffer.alloc(64, 1),
    network: "mainnet-beta",
  });
  expect(instruction.programId).toEqual(program);
  expect(instruction.keys[2].pubkey).toEqual(allocation);
  const messageOffset = verify.data.readUInt16LE(10),
    messageLength = verify.data.readUInt16LE(12);
  expect(
    verify.data.subarray(messageOffset, messageOffset + messageLength),
  ).toEqual(message);
  expect(
    claimMessage(claim, allocation, NATIVE_MINT, wallet, destination, program),
  ).toEqual(message);
  expect(
    claimMessage(
      claim,
      allocationAddress(pool),
      NATIVE_MINT,
      wallet,
      destination,
    ).subarray(0, CLAIM_DOMAIN.length),
  ).toEqual(CLAIM_DOMAIN);
});
it("rejects opposite-network claim signing and arbitrary mainnet program overrides", () => {
  for (const [program, network] of [
    [MAINNET_FEE_ESCROW_PROGRAM, "devnet"],
    [FEE_ESCROW_PROGRAM, "mainnet-beta"],
    [Keypair.generate().publicKey, "mainnet-beta"],
  ] as const) {
    expect(() =>
      claimMessage(
        claim,
        allocationAddress(pool, program),
        NATIVE_MINT,
        wallet,
        destination,
        program,
        network,
      ),
    ).toThrow("does not match");
    expect(() =>
      claimInstructions({
        claim,
        pool,
        mint: NATIVE_MINT,
        wallet,
        tokenProgram: TOKEN_PROGRAM_ID,
        verifier: wallet,
        signature: Buffer.alloc(64),
        program,
        network,
      }),
    ).toThrow("does not match");
  }
});
it("retains explicit disposable devnet program support for isolated rehearsals", () => {
  const program = Keypair.generate().publicKey;
  expect(
    claimMessage(
      claim,
      allocationAddress(pool, program),
      NATIVE_MINT,
      wallet,
      destination,
      program,
      "devnet",
    ).subarray(0, CLAIM_DOMAIN.length),
  ).toEqual(CLAIM_DOMAIN);
});
