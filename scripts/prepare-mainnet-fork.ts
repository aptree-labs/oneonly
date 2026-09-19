import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  Connection,
  Keypair,
  PublicKey,
} from "../packages/protocol/node_modules/@solana/web3.js";
import {
  AccountLayout,
  AccountState,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ExtensionType,
  getTypeLen,
} from "../packages/protocol/node_modules/@solana/spl-token";
import {
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  METAPLEX_PROGRAM_ID,
  deriveDbcPoolAuthority,
} from "../packages/protocol/node_modules/@meteora-ag/dynamic-bonding-curve-sdk";
import { deriveTokenBadgeAddress as dammBadge } from "../packages/protocol/node_modules/@meteora-ag/cp-amm-sdk";
import { MAINNET_STOCKS } from "../packages/protocol/src/mainnet-stocks";
import { GENESIS_HASHES } from "../packages/core/src/network";

// Reads public chain data only. All fabricated balances and the generated signer belong exclusively to localhost.
async function main() {
  const directory = ".data/mainnet-fork";
  await mkdir(`${directory}/accounts`, { recursive: true });
  const rpc = new Connection(
    "https://api.mainnet-beta.solana.com",
    "finalized",
  );
  if ((await rpc.getGenesisHash()) !== GENESIS_HASHES["mainnet-beta"])
    throw new Error("Unexpected source chain");
  const wallet = Keypair.generate();
  await writeFile(
    `${directory}/local-only-wallet.json`,
    JSON.stringify(Array.from(wallet.secretKey)),
    { mode: 0o600 },
  );
  const configs: { symbol: string; address: string }[] = JSON.parse(
    await readFile(".data/mainnet/confirmed-stock-configs.json", "utf8"),
  );
  const addresses = [
    ...MAINNET_STOCKS.flatMap((stock) => [
      stock.mint,
      stock.badge,
      dammBadge(new PublicKey(stock.mint)).toBase58(),
    ]),
    ...configs.map((item) => item.address),
    DAMM_V2_MIGRATION_FEE_ADDRESS[6].toBase58(),
    deriveDbcPoolAuthority().toBase58(),
  ];
  const accounts = await rpc.getMultipleAccountsInfo(
    addresses.map((address) => new PublicKey(address)),
  );
  for (let i = 0; i < addresses.length; i++) {
    const account = accounts[i];
    if (!account) throw new Error(`Missing public account ${addresses[i]}`);
    await writeFile(
      `${directory}/accounts/${addresses[i]}.json`,
      JSON.stringify({
        pubkey: addresses[i],
        account: {
          ...account,
          owner: account.owner.toBase58(),
          data: [account.data.toString("base64"), "base64"],
        },
      }),
    );
  }
  for (const stock of MAINNET_STOCKS) {
    const mint = new PublicKey(stock.mint),
      address = getAssociatedTokenAddressSync(
        mint,
        wallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
      );
    // Standard transferable account; confidential transfer remains unconfigured and disabled.
    const extensions = [
      ExtensionType.ImmutableOwner,
      ExtensionType.TransferHookAccount,
      ExtensionType.PausableAccount,
    ];
    const data = Buffer.alloc(
      166 +
        extensions.reduce(
          (total, extension) => total + 4 + getTypeLen(extension),
          0,
        ),
    );
    AccountLayout.encode(
      {
        mint,
        owner: wallet.publicKey,
        amount: 1_000_000n * 100_000_000n,
        delegateOption: 0,
        delegate: PublicKey.default,
        state: AccountState.Initialized,
        isNativeOption: 0,
        isNative: 0n,
        delegatedAmount: 0n,
        closeAuthorityOption: 0,
        closeAuthority: PublicKey.default,
      },
      data,
    );
    data[165] = 2;
    let offset = 166;
    for (const extension of extensions) {
      data.writeUInt16LE(extension, offset);
      data.writeUInt16LE(getTypeLen(extension), offset + 2);
      offset += 4 + getTypeLen(extension);
    }
    await writeFile(
      `${directory}/accounts/${address}.json`,
      JSON.stringify({
        pubkey: address.toBase58(),
        account: {
          lamports: 10_000_000,
          data: [data.toString("base64"), "base64"],
          owner: TOKEN_2022_PROGRAM_ID.toBase58(),
          executable: false,
          rentEpoch: 0,
        },
      }),
    );
  }
  const args = [
    "--ledger",
    `${directory}/ledger`,
    "--rpc-port",
    "18999",
    "--faucet-port",
    "19900",
    "--gossip-port",
    "19902",
    "--dynamic-port-range",
    "19910-19950",
    "--bind-address",
    "127.0.0.1",
    "--url",
    rpc.rpcEndpoint,
    "--account-dir",
    `${directory}/accounts`,
    "--mint",
    wallet.publicKey.toBase58(),
    "--clone-upgradeable-program",
    DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58(),
    "--clone-upgradeable-program",
    DAMM_V2_PROGRAM_ID.toBase58(),
    "--clone-upgradeable-program",
    METAPLEX_PROGRAM_ID.toBase58(),
    "--clone-upgradeable-program",
    TOKEN_2022_PROGRAM_ID.toBase58(),
  ];
  await writeFile(`${directory}/validator-args.json`, JSON.stringify(args));
  console.log(
    "Prepared local-only stock balances and copied public configurations for all five stocks.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
