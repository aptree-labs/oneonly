import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  AddressLookupTableAccount,
  type Connection,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { QUOTE_MINTS } from "./quote-assets";
export const JUPITER_PROGRAM = new PublicKey(
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
);
type Instruction = {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
};
export type RouteRequest = {
  wallet: string;
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps: number;
  inputProgram: PublicKey;
  outputProgram: PublicKey;
};
export type JupiterRoute = {
  setup: TransactionInstruction[];
  swap: TransactionInstruction;
  cleanup: TransactionInstruction[];
  lookupAddresses: string[];
  out: bigint;
  minimumOut: bigint;
};
function instruction(value: Instruction, wallet: string) {
  if (
    !value ||
    !Array.isArray(value.accounts) ||
    value.accounts.length > 100 ||
    typeof value.data !== "string" ||
    value.data.length > 4000
  )
    throw new Error("Invalid route instruction.");
  if (
    value.accounts.some(
      (account) => account.isSigner && account.pubkey !== wallet,
    )
  )
    throw new Error("Route requests an unexpected signer.");
  return new TransactionInstruction({
    programId: new PublicKey(value.programId),
    keys: value.accounts.map((account) => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: !!account.isSigner,
      isWritable: !!account.isWritable,
    })),
    data: Buffer.from(value.data, "base64"),
  });
}
/** RouteV2 and SharedAccountsRouteV2, verified against Jupiter's on-chain IDL.
 * Both enforce the reviewed amounts, zero extra fees and wallet-owned endpoints.
 */
export function validateJupiterRoute(
  data: any,
  request: RouteRequest,
): JupiterRoute {
  const bad = () => {
    throw new Error(
      "The swap route does not match the requested assets or limits.",
    );
  };
  if (
    !data ||
    data.inputMint !== request.inputMint ||
    data.outputMint !== request.outputMint ||
    data.inAmount !== request.amount.toString() ||
    data.swapMode !== "ExactIn" ||
    data.slippageBps !== request.slippageBps ||
    !/^\d+$/.test(data.outAmount) ||
    !/^\d+$/.test(data.otherAmountThreshold)
  )
    return bad();
  const out = BigInt(data.outAmount),
    minimumOut = BigInt(data.otherAmountThreshold);
  if (
    out <= 0n ||
    out > 18446744073709551615n ||
    minimumOut <= 0n ||
    minimumOut > out ||
    minimumOut < (out * BigInt(10000 - request.slippageBps)) / 10000n
  )
    return bad();
  const owner = new PublicKey(request.wallet),
    source = getAssociatedTokenAddressSync(
      new PublicKey(request.inputMint),
      owner,
      false,
      request.inputProgram,
    ),
    destination = getAssociatedTokenAddressSync(
      new PublicKey(request.outputMint),
      owner,
      false,
      request.outputProgram,
    );
  const swap = instruction(data.swapInstruction, request.wallet),
    bytes = swap.data;
  const discriminator = bytes.subarray(0, 8).toString("hex");
  const shared = discriminator === "d19853937cfed8e9";
  const offset = shared ? 1 : 0;
  if (
    !swap.programId.equals(JUPITER_PROGRAM) ||
    bytes.length < 34 + offset ||
    (!shared && discriminator !== "bb64facc31c4af14") ||
    bytes.readBigUInt64LE(8 + offset) !== request.amount ||
    bytes.readBigUInt64LE(16 + offset) !== out ||
    bytes.readUInt16LE(24 + offset) !== request.slippageBps ||
    bytes.readUInt16LE(26 + offset) !== 0 ||
    bytes.readUInt16LE(28 + offset) !== 0
  )
    return bad();
  const eventAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    JUPITER_PROGRAM,
  )[0];
  const authority = shared
    ? PublicKey.findProgramAddressSync(
        [Buffer.from("authority"), bytes.subarray(8, 9)],
        JUPITER_PROGRAM,
      )[0]
    : null;
  const expected = shared
    ? [
        authority!,
        owner,
        source,
        getAssociatedTokenAddressSync(
          new PublicKey(request.inputMint),
          authority!,
          true,
          request.inputProgram,
        ),
        getAssociatedTokenAddressSync(
          new PublicKey(request.outputMint),
          authority!,
          true,
          request.outputProgram,
        ),
        destination,
        new PublicKey(request.inputMint),
        new PublicKey(request.outputMint),
        request.inputProgram,
        request.outputProgram,
        eventAuthority,
        JUPITER_PROGRAM,
      ]
    : [
        owner,
        source,
        destination,
        new PublicKey(request.inputMint),
        new PublicKey(request.outputMint),
        request.inputProgram,
        request.outputProgram,
        JUPITER_PROGRAM, // Optional destination override must be absent.
        eventAuthority,
        JUPITER_PROGRAM,
      ];
  if (
    expected.some((key, i) => !swap.keys[i]?.pubkey.equals(key)) ||
    !swap.keys[shared ? 1 : 0]?.isSigner
  )
    return bad();
  if (
    !Array.isArray(data.setupInstructions) ||
    data.setupInstructions.length > 12 ||
    data.otherInstructions?.length ||
    data.tipInstruction
  )
    return bad();
  const native = getAssociatedTokenAddressSync(
    new PublicKey(QUOTE_MINTS.SOL),
    owner,
  );
  let wrapped = 0n;
  const setup = data.setupInstructions.map((raw: Instruction) => {
    const ix = instruction(raw, request.wallet);
    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      const [payer, ata, recipient, mint, system, token] = ix.keys;
      if (
        ix.data.length !== 1 ||
        ix.data[0] !== 1 ||
        !payer?.pubkey.equals(owner) ||
        !recipient?.pubkey.equals(owner) ||
        !system?.pubkey.equals(SystemProgram.programId) ||
        !token ||
        ![TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].some((program) =>
          program.equals(token.pubkey),
        ) ||
        !ata.pubkey.equals(
          getAssociatedTokenAddressSync(
            mint.pubkey,
            owner,
            false,
            token.pubkey,
          ),
        )
      )
        return bad();
    } else if (ix.programId.equals(SystemProgram.programId)) {
      if (
        request.inputMint !== QUOTE_MINTS.SOL ||
        ix.data.length !== 12 ||
        ix.data.readUInt32LE(0) !== 2 ||
        !ix.keys[0]?.pubkey.equals(owner) ||
        !ix.keys[1]?.pubkey.equals(native)
      )
        return bad();
      wrapped += ix.data.readBigUInt64LE(4);
      if (wrapped > request.amount) return bad();
    } else if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
      if (
        ix.data.length !== 1 ||
        ix.data[0] !== 17 ||
        !ix.keys[0]?.pubkey.equals(native)
      )
        return bad();
    } else return bad();
    return ix;
  });
  const cleanup: TransactionInstruction[] = [];
  if (data.cleanupInstruction) {
    const ix = instruction(data.cleanupInstruction, request.wallet);
    if (
      !ix.programId.equals(TOKEN_PROGRAM_ID) ||
      ix.data.length !== 1 ||
      ix.data[0] !== 9 ||
      !ix.keys[0]?.pubkey.equals(native) ||
      !ix.keys[1]?.pubkey.equals(owner) ||
      !ix.keys[2]?.pubkey.equals(owner)
    )
      return bad();
    cleanup.push(ix);
  }
  const lookupAddresses = Object.keys(data.addressesByLookupTableAddress ?? {});
  if (lookupAddresses.length > 8) return bad();
  return { setup, swap, cleanup, lookupAddresses, out, minimumOut };
}
export async function jupiterRoute(request: RouteRequest) {
  const params = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amount.toString(),
    taker: request.wallet,
    slippageBps: String(request.slippageBps),
    maxAccounts: "32",
    platformFeeBps: "0",
  });
  const response = await fetch(`https://api.jup.ag/swap/v2/build?${params}`, {
    headers: process.env.JUPITER_API_KEY
      ? { "x-api-key": process.env.JUPITER_API_KEY }
      : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new Error(
      "A conversion route is unavailable. Try again or trade using the pool’s quote asset.",
    );
  return validateJupiterRoute(await response.json(), request);
}
export async function routeLookupTables(
  rpc: Connection,
  addresses: string[],
): Promise<AddressLookupTableAccount[]> {
  // Read the actual tables from the active chain; never trust provider-supplied address substitutions.
  return Promise.all(
    addresses.map(async (address) => {
      const { value } = await rpc.getAddressLookupTable(new PublicKey(address));
      if (!value || !value.isActive())
        throw new Error("The route's address table is unavailable.");
      return value;
    }),
  );
}
