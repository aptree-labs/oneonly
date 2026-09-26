import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  Connection,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  DynamicBondingCurveClient,
  deriveDbcPoolAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { allocationAddress, initializeAllocationInstruction } from "../src";
const short = (n: number) => (n < 128 ? 1 : n < 16384 ? 2 : 3);
export function wireLength(tx: Transaction) {
  const m = tx.compileMessage();
  return (
    short(m.header.numRequiredSignatures) +
    64 * m.header.numRequiredSignatures +
    3 +
    short(m.accountKeys.length) +
    m.accountKeys.length * 32 +
    32 +
    short(m.instructions.length) +
    m.instructions.reduce((n, i) => {
      const bytes = tx.instructions[m.instructions.indexOf(i)].data.length;
      return (
        n +
        1 +
        short(i.accounts.length) +
        i.accounts.length +
        short(bytes) +
        bytes
      );
    }, 0)
  );
}
it("measures SDK Token2022 launch packets with immutable fee allocation and both fee budgets", async () => {
  const connection = new Connection("https://api.devnet.solana.com");
  connection.getAccountInfo = async (key) =>
    key.equals(NATIVE_MINT)
      ? {
          owner: TOKEN_PROGRAM_ID,
          data: Buffer.alloc(82),
          lamports: 1,
          executable: false,
        }
      : null;
  const sdk = new DynamicBondingCurveClient(connection, "confirmed");
  const creator = sdk.creator as any;
  const config = creator.program.coder.accounts.decode(
    "poolConfig",
    Buffer.from(
      readFileSync(
        fileURLToPath(new URL("./fixtures/dbc-config.base64", import.meta.url)),
        "utf8",
      ).trim(),
      "base64",
    ),
  );
  config.tokenType = 1;
  config.quoteMint = NATIVE_MINT;
  config.poolFees.baseFee.baseFeeMode = 0;
  creator.getPoolConfigForNewPool = async () => config;
  const payer = Keypair.generate(),
    mint = Keypair.generate(),
    configKey = Keypair.generate().publicKey,
    DBC = creator.program.programId;
  const pool = deriveDbcPoolAddress(NATIVE_MINT, mint.publicKey, configKey),
    allocation = allocationAddress(pool);
  const params = {
    config: configKey,
    baseMint: mint.publicKey,
    payer: payer.publicKey,
    poolCreator: payer.publicKey,
    name: "Escrow Test Token",
    symbol: "FEEDEV",
    uri: "https://staging.oneonly.lol/api/launchpad/metadata/12345678-1234-1234-1234-123456789012",
  };
  const transfer = new TransactionInstruction({
    programId: DBC,
    data: Buffer.from([20, 7, 169, 33, 58, 147, 166, 33]),
    keys: [
      { pubkey: pool, isWritable: true, isSigner: false },
      { pubkey: configKey, isWritable: false, isSigner: false },
      { pubkey: payer.publicKey, isWritable: false, isSigner: true },
      { pubkey: allocation, isWritable: false, isSigner: false },
      {
        pubkey: PublicKey.findProgramAddressSync(
          [Buffer.from("__event_authority")],
          DBC,
        )[0],
        isWritable: false,
        isSigner: false,
      },
      { pubkey: DBC, isWritable: false, isSigner: false },
      {
        pubkey: Keypair.generate().publicKey,
        isWritable: false,
        isSigner: false,
      },
    ],
  });
  const measurements = [];
  for (const firstBuy of [false, true])
    for (const recipients of [1, 2, 8]) {
      const created = firstBuy
        ? await sdk.creator.createPoolWithFirstBuy({
            createPoolParam: params,
            firstBuyParam: {
              buyer: payer.publicKey,
              receiver: payer.publicKey,
              buyAmount: new BN(10000000),
              minimumAmountOut: new BN(1),
              referralTokenAccount: null,
            },
          })
        : await sdk.creator.createPool(params);
      const tx = new Transaction({
        feePayer: payer.publicKey,
        recentBlockhash: PublicKey.default.toBase58(),
      }).add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 800000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
        ...created.instructions,
        initializeAllocationInstruction({
          payer: payer.publicKey,
          pool,
          dbcConfig: configKey,
          baseMint: mint.publicKey,
          quoteMint: NATIVE_MINT,
          shares: Array.from({ length: recipients }, (_, i) => ({
            xId: String(i + 1),
            shareBps: 10000 / recipients,
          })),
          transferInstruction: transfer,
        }),
      );
      const bytes = wireLength(tx);
      measurements.push({ firstBuy, recipients, bytes, fits: bytes <= 1232 });
    }
  console.log(
    "Launch wire sizes (includes payer + mint signatures):",
    measurements,
  );
  expect(
    measurements.find((x) => !x.firstBuy && x.recipients === 2)!.fits,
  ).toBe(true);
  expect(measurements.find((x) => x.firstBuy && x.recipients === 8)!.fits).toBe(
    false,
  );
});
