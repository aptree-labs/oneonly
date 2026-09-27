import { createHash } from "node:crypto";
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  allocationAddress,
  beneficiaryAddress,
  claimedAddress,
  configAddress,
  controlAddress,
  decodeConfig,
  decodeControl,
  decodeAllocation,
  decodeBeneficiary,
  decodeClaimed,
  decodeLedger,
  discriminator,
  ledgerAddress,
} from "./index";

const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
type ObservedAccount = { pubkey: PublicKey; account: AccountInfo<Buffer> };
export type RetirementBlocker =
  | "NETWORK_MISMATCH"
  | "RPC_EVIDENCE_UNAVAILABLE"
  | "INVALID_PROGRAM"
  | "INVALID_PROGRAM_DATA"
  | "AUTHORITY_MISMATCH"
  | "IMMUTABLE_PROGRAM"
  | "REFUND_DESTINATION_MISMATCH"
  | "INVALID_ACCOUNT_INVENTORY"
  | "ALLOCATION_FEE_RIGHTS_REMAIN"
  | "UNPAID_ENTITLEMENTS"
  | "UNBOUND_RECIPIENTS"
  | "RETIREMENT_PROTOCOL_NOT_IMPLEMENTED";

export type RetirementReport = {
  /** Deliberately never authorizes loader closure. This module creates no transactions. */
  safeToClose: false;
  blockers: RetirementBlocker[];
  observedAt: string;
  inventorySlot?: number;
  allocationCount: number;
  unboundRecipientCount: number;
  unpaidByMint: Record<string, string>;
  /** Escrow account rent is not the deployment wallet's refund. */
  escrowAccountLamports?: string;
  programDataLamports?: string;
  programAccountLamports?: string;
  limitations: string[];
};

export type DfsMigrationCandidate = {
  quoteMint: PublicKey;
  recipients: {
    xIdHash: Buffer;
    shareBps: number;
    /** Must come from the on-chain beneficiary binding, not a handle lookup. */
    wallet: PublicKey | null;
  }[];
  /** Planning evidence only; execution must require the actual wallet signatures. */
  consentingWallets: PublicKey[];
  dbcStage:
    "pre-curve" | "graduated-damm-v2" | "migration-in-progress" | "unsupported";
  dbcFees: "quote-only" | "both" | "unknown";
  dammFees: "quote-only" | "both" | "unknown";
  otherFeeOrRewardRights: "none" | "present" | "unknown";
  vault: {
    /** Owner program/version verification must be done independently on chain. */
    address: PublicKey;
    isPda: boolean;
    mint: PublicKey;
    users: { wallet: PublicKey; share: number }[];
    totalFunded: bigint;
    feePerShare: bigint;
  };
};

/**
 * Narrow compatibility planner for a direct Meteora DFS successor. This is NOT
 * a migration or closure authorization: supplied observations/consents are not
 * cryptographic evidence. It only identifies a candidate worth a devnet rehearsal.
 */
export function planDfsRetirement(candidate: DfsMigrationCandidate) {
  const blockers: string[] = [];
  const shares = candidate.recipients;
  if (shares.length < 2 || shares.length > 5)
    blockers.push("DFS_REQUIRES_TWO_TO_FIVE_RECIPIENTS");
  if (
    shares.some(
      (s) =>
        !Number.isInteger(s.shareBps) ||
        s.shareBps <= 0 ||
        s.shareBps > 10000 ||
        s.xIdHash.length !== 32,
    ) ||
    shares.reduce((sum, s) => sum + s.shareBps, 0) !== 10000 ||
    new Set(shares.map((s) => s.xIdHash.toString("hex"))).size !== shares.length
  )
    blockers.push("INVALID_IMMUTABLE_SHARES");
  if (shares.some((s) => !s.wallet || s.wallet.equals(PublicKey.default)))
    blockers.push("ALL_X_RECIPIENTS_MUST_BIND");
  const wallets = shares.flatMap((s) =>
    s.wallet ? [s.wallet.toBase58()] : [],
  );
  if (new Set(wallets).size !== wallets.length)
    blockers.push("DUPLICATE_BOUND_WALLET");
  if (
    shares.some(
      (s) =>
        !s.wallet ||
        !candidate.consentingWallets.some((w) => w.equals(s.wallet!)),
    )
  )
    blockers.push("ALL_RECIPIENTS_MUST_CONSENT_TO_WALLET_ONLY_CLAIMS");
  if (!["pre-curve", "graduated-damm-v2"].includes(candidate.dbcStage))
    blockers.push("UNSUPPORTED_MIGRATION_STAGE");
  if (candidate.dbcFees !== "quote-only" || candidate.dammFees !== "quote-only")
    blockers.push("BOTH_CURRENT_AND_FUTURE_FEES_MUST_BE_QUOTE_ONLY");
  if (candidate.otherFeeOrRewardRights !== "none")
    blockers.push("UNRESOLVED_OTHER_FEE_OR_REWARD_RIGHTS");
  if (
    !candidate.vault.isPda ||
    !candidate.vault.mint.equals(candidate.quoteMint)
  )
    blockers.push("INVALID_DFS_VAULT_SCOPE");
  // New empty vault only. Old entitlements must be paid individually; funding a
  // common new split vault with leftovers would redistribute partial claims.
  if (candidate.vault.totalFunded !== 0n || candidate.vault.feePerShare !== 0n)
    blockers.push("DFS_VAULT_MUST_BE_UNFUNDED");
  if (
    candidate.vault.users.length !== shares.length ||
    new Set(candidate.vault.users.map((u) => u.wallet.toBase58())).size !==
      shares.length ||
    shares.some(
      (s) =>
        !s.wallet ||
        !candidate.vault.users.some(
          (u) => u.wallet.equals(s.wallet!) && u.share === s.shareBps,
        ),
    )
  )
    blockers.push("DFS_SHARES_MUST_MATCH_ALLOCATION_EXACTLY");
  return {
    candidateForDevnetRehearsal: blockers.length === 0,
    safeToClose: false as const,
    blockers,
    requirements: [
      "Reverify pinned deployed DFS program, PDA derivation, full vault contents and supported mint extensions on chain.",
      "Require every bound recipient's fresh signature over this allocation, successor and changed future claim policy.",
      "Settle old cumulative entitlements individually; do not re-split partially claimed balances through DFS.",
      "Transfer DBC creator authority and every relevant DAMM position NFT under the old allocation PDA's signature.",
      "Reconcile migration, unclaimed balances, donations, rounding dust, external fee rights and account rent before closure.",
    ],
  };
}

function kind(account: AccountInfo<Buffer>, name: string) {
  return account.data.subarray(0, 8).equals(discriminator("account", name));
}

/**
 * Compute obligations from a complete program-owned account scan, not the app DB.
 * Unbound identities remain beneficiaries. Claim receipts are not substituted for
 * cumulative Claimed accounts. Unknown/malformed data makes the scan unusable.
 */
export function inspectRetirementAccounts(
  program: PublicKey,
  accounts: readonly ObservedAccount[],
) {
  const byKey = new Map<string, AccountInfo<Buffer>>();
  let lamports = 0n;
  for (const { pubkey, account } of accounts) {
    if (
      !account.owner.equals(program) ||
      account.executable ||
      !Number.isSafeInteger(account.lamports) ||
      account.lamports < 0 ||
      byKey.has(pubkey.toBase58()) ||
      ![
        "Config",
        "Control",
        "Allocation",
        "Ledger",
        "Beneficiary",
        "Claimed",
        "Receipt",
      ].some((name) => kind(account, name))
    )
      throw new Error("Unrecognized or invalid escrow account inventory");
    byKey.set(pubkey.toBase58(), account);
    lamports += BigInt(account.lamports);
    if (kind(account, "Config")) {
      decodeConfig(account, program);
      if (!pubkey.equals(configAddress(program)))
        throw new Error("Wrong config PDA");
    }
    if (kind(account, "Control")) {
      decodeControl(account, program);
      if (!pubkey.equals(controlAddress(program)))
        throw new Error("Wrong control PDA");
    }
  }
  const unpaid = new Map<string, bigint>();
  const unbound = new Set<string>();
  const seenLedgers = new Set<string>();
  const seenClaims = new Set<string>();
  const seenBeneficiaries = new Set<string>();
  let allocationCount = 0;
  for (const { pubkey, account } of accounts) {
    if (!kind(account, "Allocation")) continue;
    const allocation = decodeAllocation(account, program);
    if (!allocationAddress(allocation.pool, program).equals(pubkey))
      throw new Error("Allocation address mismatch");
    if (allocation.baseMint.equals(allocation.quoteMint))
      throw new Error("Duplicate allocation mints");
    const identities = new Set<string>();
    for (const share of allocation.shares) {
      const hash = share.xIdHash.toString("hex");
      if (share.shareBps <= 0 || identities.has(hash))
        throw new Error("Invalid allocation identity or share");
      identities.add(hash);
      const bindingKey = beneficiaryAddress(share.xIdHash, program).toBase58();
      const binding = byKey.get(bindingKey);
      if (!binding) unbound.add(hash);
      else {
        const decoded = decodeBeneficiary(binding, program);
        if (
          !decoded.xIdHash.equals(share.xIdHash) ||
          decoded.version < 1n ||
          decoded.wallet.equals(PublicKey.default)
        )
          throw new Error("Invalid beneficiary binding");
        seenBeneficiaries.add(bindingKey);
      }
    }
    allocationCount++;
    for (const mint of [allocation.baseMint, allocation.quoteMint]) {
      const ledgerKey = ledgerAddress(pubkey, mint, program);
      const ledgerAccount = byKey.get(ledgerKey.toBase58());
      // No ledger means nothing collected, not that future fees are zero.
      if (!ledgerAccount) continue;
      const ledger = decodeLedger(ledgerAccount, program);
      if (!ledger.allocation.equals(pubkey) || !ledger.mint.equals(mint))
        throw new Error("Ledger scope mismatch");
      seenLedgers.add(ledgerKey.toBase58());
      let remaining = 0n;
      for (const share of allocation.shares) {
        const entitlement =
          (ledger.totalReceived * BigInt(share.shareBps)) / 10_000n;
        const claimKey = claimedAddress(
          ledgerKey,
          share.xIdHash,
          program,
        ).toBase58();
        const claim = byKey.get(claimKey);
        const paid = claim ? decodeClaimed(claim, program) : 0n;
        if (paid > entitlement)
          throw new Error("Paid amount exceeds entitlement");
        if (claim) seenClaims.add(claimKey);
        remaining += entitlement - paid;
      }
      unpaid.set(
        mint.toBase58(),
        (unpaid.get(mint.toBase58()) ?? 0n) + remaining,
      );
    }
  }
  for (const { pubkey, account } of accounts) {
    if (
      (kind(account, "Ledger") && !seenLedgers.has(pubkey.toBase58())) ||
      (kind(account, "Claimed") && !seenClaims.has(pubkey.toBase58())) ||
      (kind(account, "Beneficiary") &&
        !seenBeneficiaries.has(pubkey.toBase58()))
    )
      throw new Error("Orphan accounting state requires investigation");
  }
  return {
    allocationCount,
    unboundRecipientCount: unbound.size,
    unpaidByMint: Object.fromEntries(
      [...unpaid].map(([mint, amount]) => [mint, amount.toString()]),
    ),
    escrowAccountLamports: lamports.toString(),
  };
}

/**
 * Read-only, finalized preflight. Even an empty inventory is not permission to
 * close: scans cannot enforce a seal, prove all external fee rights migrated,
 * or prevent the upgrade authority invoking the loader directly.
 */
export async function inspectRetirement(args: {
  connection: Pick<
    Connection,
    "getGenesisHash" | "getAccountInfo" | "getProgramAccounts"
  >;
  program: PublicKey;
  expectedGenesisHash: string;
  expectedAuthority: PublicKey;
  refundDestination: PublicKey;
}): Promise<RetirementReport> {
  const report: RetirementReport = {
    safeToClose: false,
    blockers: ["RETIREMENT_PROTOCOL_NOT_IMPLEMENTED"],
    observedAt: new Date().toISOString(),
    allocationCount: 0,
    unboundRecipientCount: 0,
    unpaidByMint: {},
    limitations: [
      "An empty escrow balance does not extinguish future DBC or DAMM creator-fee rights.",
      "The account scan excludes external token accounts, position NFTs and uncollected Meteora fees.",
      "Snapshots are observations, not an atomic retirement seal or a closure authorization.",
      "User account rent, donation balances and rounding dust are not deployer refunds.",
    ],
  };
  if (!args.refundDestination.equals(args.expectedAuthority))
    report.blockers.push("REFUND_DESTINATION_MISMATCH");
  try {
    if (
      !args.expectedGenesisHash ||
      (await args.connection.getGenesisHash()) !== args.expectedGenesisHash
    ) {
      report.blockers.push("NETWORK_MISMATCH");
      return report;
    }
    const program = await args.connection.getAccountInfo(
      args.program,
      "finalized",
    );
    if (
      !program?.executable ||
      !program.owner.equals(LOADER) ||
      program.data.length !== 36 ||
      program.data.readUInt32LE(0) !== 2
    ) {
      report.blockers.push("INVALID_PROGRAM");
      return report;
    }
    const [dataAddress] = PublicKey.findProgramAddressSync(
      [args.program.toBuffer()],
      LOADER,
    );
    if (!new PublicKey(program.data.subarray(4, 36)).equals(dataAddress)) {
      report.blockers.push("INVALID_PROGRAM_DATA");
      return report;
    }
    const data = await args.connection.getAccountInfo(dataAddress, "finalized");
    if (
      !data ||
      !data.owner.equals(LOADER) ||
      data.executable ||
      data.data.length < 45 ||
      data.data.readUInt32LE(0) !== 3 ||
      ![0, 1].includes(data.data[12]) ||
      !Number.isSafeInteger(program.lamports) ||
      !Number.isSafeInteger(data.lamports) ||
      program.lamports < 0 ||
      data.lamports < 0
    ) {
      report.blockers.push("INVALID_PROGRAM_DATA");
      return report;
    }
    report.programDataLamports = String(data.lamports);
    report.programAccountLamports = String(program.lamports);
    if (data.data[12] === 0) report.blockers.push("IMMUTABLE_PROGRAM");
    else if (
      !new PublicKey(data.data.subarray(13, 45)).equals(args.expectedAuthority)
    )
      report.blockers.push("AUTHORITY_MISMATCH");
    // No filters or data slices: silently excluding an allocation is unsafe.
    const scan = await args.connection.getProgramAccounts(args.program, {
      commitment: "finalized",
      withContext: true,
    });
    if (!Number.isSafeInteger(scan.context.slot) || scan.context.slot < 0) {
      report.blockers.push("INVALID_ACCOUNT_INVENTORY");
      return report;
    }
    report.inventorySlot = scan.context.slot;
    try {
      Object.assign(
        report,
        inspectRetirementAccounts(args.program, scan.value),
      );
    } catch {
      report.blockers.push("INVALID_ACCOUNT_INVENTORY");
      return report;
    }
    if (report.allocationCount)
      report.blockers.push("ALLOCATION_FEE_RIGHTS_REMAIN");
    if (report.unboundRecipientCount)
      report.blockers.push("UNBOUND_RECIPIENTS");
    if (
      Object.values(report.unpaidByMint).some((amount) => BigInt(amount) > 0n)
    )
      report.blockers.push("UNPAID_ENTITLEMENTS");
  } catch {
    // Do not leak RPC URLs/credentials or mistake failed inventory for zero.
    report.blockers.push("RPC_EVIDENCE_UNAVAILABLE");
  }
  return report;
}

/**
 * A business-abort review for a genuinely unused deployment. Still no closure
 * authorization: the initial deployment receipt/provenance must be independently
 * reviewed and the upgrade authority must not submit concurrent changes.
 */
export async function inspectUnusedDeployment(
  args: Parameters<typeof inspectRetirement>[0] & {
    connection: Parameters<typeof inspectRetirement>[0]["connection"] &
      Pick<Connection, "getTokenAccountsByOwner">;
    reviewedArtifact: Uint8Array;
    reviewedArtifactSha256: string;
    /** Slot extracted independently from the original finalized deployment receipt. */
    initialDeploymentSlot: number;
  },
) {
  const report = await inspectRetirement(args);
  const blockers: string[] = report.blockers.filter(
    (b) => b !== "RETIREMENT_PROTOCOL_NOT_IMPLEMENTED",
  );
  const observed = {
    safeToClose: false as const,
    candidateForManualUnusedClosureReview: false,
    report,
    blockers,
  };
  if (blockers.length) return observed;
  try {
    const sha = (bytes: Uint8Array) =>
      createHash("sha256").update(bytes).digest("hex");
    if (
      args.reviewedArtifact.length < 64 ||
      !/^[a-f0-9]{64}$/.test(args.reviewedArtifactSha256) ||
      sha(args.reviewedArtifact) !== args.reviewedArtifactSha256
    ) {
      blockers.push("REVIEWED_ARTIFACT_REQUIRED");
      return observed;
    }
    const [pd] = PublicKey.findProgramAddressSync(
      [args.program.toBuffer()],
      LOADER,
    );
    const deployed = await args.connection.getAccountInfo(pd, "finalized");
    if (
      !deployed ||
      !deployed.owner.equals(LOADER) ||
      deployed.data.length < 45 + args.reviewedArtifact.length ||
      deployed.data.readUInt32LE(0) !== 3 ||
      deployed.data[12] !== 1 ||
      !new PublicKey(deployed.data.subarray(13, 45)).equals(
        args.expectedAuthority,
      ) ||
      sha(deployed.data.subarray(45, 45 + args.reviewedArtifact.length)) !==
        args.reviewedArtifactSha256 ||
      deployed.data
        .subarray(45 + args.reviewedArtifact.length)
        .some((b) => b !== 0)
    ) {
      blockers.push("DEPLOYED_ARTIFACT_OR_AUTHORITY_CHANGED");
      return observed;
    }
    if (
      !Number.isSafeInteger(args.initialDeploymentSlot) ||
      args.initialDeploymentSlot <= 0 ||
      deployed.data.readBigUInt64LE(4) !== BigInt(args.initialDeploymentSlot)
    ) {
      blockers.push("ORIGINAL_DEPLOYMENT_PROVENANCE_REQUIRED");
      return observed;
    }
    const scan = await args.connection.getProgramAccounts(args.program, {
      commitment: "finalized",
      withContext: true,
      minContextSlot: report.inventorySlot,
    });
    const config = scan.value.find((a) =>
      a.pubkey.equals(configAddress(args.program)),
    );
    const control = scan.value.find((a) =>
      a.pubkey.equals(controlAddress(args.program)),
    );
    if (
      scan.value.length !== 2 ||
      !config ||
      !control ||
      scan.context.slot < (report.inventorySlot ?? 0)
    ) {
      blockers.push("ONLY_CONFIG_AND_CONTROL_MAY_EXIST");
      return observed;
    }
    inspectRetirementAccounts(args.program, scan.value);
    if (!decodeControl(control.account, args.program).paused) {
      blockers.push("FINALIZED_PAUSE_REQUIRED");
      return observed;
    }
    // Strictly reject even empty token accounts: unknown authority/rent obligations
    // deserve review instead of interpreting a zero amount as no external rights.
    for (const owner of [args.program, config.pubkey, control.pubkey]) {
      for (const tokenProgram of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
        const tokens = await args.connection.getTokenAccountsByOwner(
          owner,
          { programId: tokenProgram },
          { commitment: "finalized", minContextSlot: scan.context.slot },
        );
        if (
          tokens.context.slot < scan.context.slot ||
          tokens.value.length !== 0
        ) {
          blockers.push("KNOWN_PDA_TOKEN_ASSETS_OR_INCOMPLETE_SCAN");
          return observed;
        }
      }
    }
    observed.candidateForManualUnusedClosureReview = true;
    return observed;
  } catch {
    blockers.push("UNUSED_DEPLOYMENT_EVIDENCE_UNAVAILABLE");
    return observed;
  }
}
