import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import {
  allocationAddress,
  beneficiaryAddress,
  claimedAddress,
  discriminator,
  ledgerAddress,
  xIdHash,
  configAddress,
  controlAddress,
} from "../src/index";
import {
  inspectRetirement,
  inspectRetirementAccounts,
  inspectUnusedDeployment,
  planDfsRetirement,
  type DfsMigrationCandidate,
} from "../src/retirement";

const key = (n: number) => new PublicKey(Buffer.alloc(32, n));
const program = key(1),
  authority = key(2),
  pool = key(3),
  base = key(4),
  quote = key(5);
const allocation = allocationAddress(pool, program);
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const dataAddress = PublicKey.findProgramAddressSync(
  [program.toBuffer()],
  loader,
)[0];
function info(
  data: Buffer,
  owner = program,
  executable = false,
): AccountInfo<Buffer> {
  return { data, owner, executable, lamports: 10000, rentEpoch: 0 };
}
function data(name: string, size: number) {
  const b = Buffer.alloc(size);
  discriminator("account", name).copy(b);
  return b;
}
function fixture(total = 101n, paid = 10n) {
  const a = data("Allocation", 209);
  pool.toBuffer().copy(a, 8);
  base.toBuffer().copy(a, 40);
  quote.toBuffer().copy(a, 72);
  authority.toBuffer().copy(a, 104);
  a.writeUInt32LE(2, 137);
  xIdHash("1").copy(a, 141);
  a.writeUInt16LE(2500, 173);
  xIdHash("2").copy(a, 175);
  a.writeUInt16LE(7500, 207);
  const l = data("Ledger", 80);
  allocation.toBuffer().copy(l, 8);
  quote.toBuffer().copy(l, 40);
  l.writeBigUInt64LE(total, 72);
  const c = data("Claimed", 16);
  c.writeBigUInt64LE(paid, 8);
  const b = data("Beneficiary", 80);
  xIdHash("1").copy(b, 8);
  authority.toBuffer().copy(b, 40);
  b.writeBigUInt64LE(1n, 72);
  return [
    { pubkey: allocation, account: info(a) },
    { pubkey: ledgerAddress(allocation, quote, program), account: info(l) },
    {
      pubkey: claimedAddress(
        ledgerAddress(allocation, quote, program),
        xIdHash("1"),
        program,
      ),
      account: info(c),
    },
    { pubkey: beneficiaryAddress(xIdHash("1"), program), account: info(b) },
  ];
}
function rpc(accounts = fixture()) {
  const p = Buffer.alloc(36);
  p.writeUInt32LE(2);
  dataAddress.toBuffer().copy(p, 4);
  const d = Buffer.alloc(46);
  d.writeUInt32LE(3);
  d[12] = 1;
  authority.toBuffer().copy(d, 13);
  const getAccountInfo = vi.fn(async (address: PublicKey) =>
    address.equals(program) ? info(p, loader, true) : info(d, loader),
  );
  const getProgramAccounts = vi.fn(async () => ({
    context: { slot: 42 },
    value: accounts,
  }));
  const raw = {
    getGenesisHash: vi.fn(async () => "expected-genesis"),
    getAccountInfo,
    getProgramAccounts,
  };
  return { raw, connection: raw as unknown as Connection, p, d };
}
async function inspect(
  r = rpc(),
  overrides: Partial<Parameters<typeof inspectRetirement>[0]> = {},
) {
  return inspectRetirement({
    connection: r.connection,
    program,
    expectedGenesisHash: "expected-genesis",
    expectedAuthority: authority,
    refundDestination: authority,
    ...overrides,
  });
}

describe("retirement accounting", () => {
  it("retains unpaid shares for recipients who have never bound a wallet, excluding floor dust", () => {
    const result = inspectRetirementAccounts(program, fixture());
    expect(result).toMatchObject({
      allocationCount: 1,
      unboundRecipientCount: 1,
      unpaidByMint: { [quote.toBase58()]: "90" },
      escrowAccountLamports: "40000",
    });
  });
  it("does not label an uncollected allocation free of future obligations", async () => {
    const report = await inspect(rpc(fixture().slice(0, 1)));
    expect(report.unpaidByMint).toEqual({});
    expect(report.blockers).toContain("ALLOCATION_FEE_RIGHTS_REMAIN");
    expect(report.unboundRecipientCount).toBe(2);
    expect(report.safeToClose).toBe(false);
  });
  it("never mixes units when summing obligations for two mints", () => {
    const f = fixture();
    const l = Buffer.from(f[1].account.data);
    base.toBuffer().copy(l, 40);
    l.writeBigUInt64LE(8n, 72);
    f.push({
      pubkey: ledgerAddress(allocation, base, program),
      account: info(l),
    });
    expect(inspectRetirementAccounts(program, f).unpaidByMint).toEqual({
      [quote.toBase58()]: "90",
      [base.toBase58()]: "8",
    });
  });
  it("does not round financial base units through floating point", () => {
    const total = (1n << 63n) + 133n;
    const expected = (total * 2500n) / 10000n + (total * 7500n) / 10000n;
    expect(
      inspectRetirementAccounts(program, fixture(total, 0n)).unpaidByMint[
        quote.toBase58()
      ],
    ).toBe(String(expected));
  });
  it.each([
    "owner",
    "duplicate",
    "unknown",
    "truncated",
    "pda",
    "overspent",
    "orphan",
    "duplicate-recipient",
  ])("rejects %s inventory rather than report zero liability", (failure) => {
    const f = fixture();
    if (failure === "owner") f[0].account.owner = key(8);
    if (failure === "duplicate") f.push(f[0]);
    if (failure === "unknown")
      f.push({ pubkey: key(9), account: info(Buffer.alloc(20)) });
    if (failure === "truncated")
      f[0].account.data = f[0].account.data.subarray(0, 20);
    if (failure === "pda") f[0].pubkey = key(9);
    if (failure === "overspent") f[2].account.data.writeBigUInt64LE(26n, 8);
    if (failure === "orphan") f.splice(0, 1);
    if (failure === "duplicate-recipient")
      xIdHash("1").copy(f[0].account.data, 175);
    expect(() => inspectRetirementAccounts(program, f)).toThrow();
  });
});

describe("read-only closure preflight", () => {
  it("reports authority, finalized inventory and unpaid obligations without approving closure", async () => {
    const r = rpc();
    const report = await inspect(r);
    expect(report).toMatchObject({
      safeToClose: false,
      inventorySlot: 42,
      programDataLamports: "10000",
    });
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        "RETIREMENT_PROTOCOL_NOT_IMPLEMENTED",
        "ALLOCATION_FEE_RIGHTS_REMAIN",
        "UNPAID_ENTITLEMENTS",
        "UNBOUND_RECIPIENTS",
      ]),
    );
    expect(r.raw.getProgramAccounts).toHaveBeenCalledWith(program, {
      commitment: "finalized",
      withContext: true,
    });
  });
  it("does not authorize closure even for an empty scan or fully paid ledger", async () => {
    expect((await inspect(rpc([]))).safeToClose).toBe(false);
    const f = fixture(0n, 0n);
    const report = await inspect(rpc(f));
    expect(report.blockers).not.toContain("UNPAID_ENTITLEMENTS");
    expect(report.blockers).toContain("ALLOCATION_FEE_RIGHTS_REMAIN");
    expect(report.safeToClose).toBe(false);
  });
  it("stops on wrong genesis before account reads", async () => {
    const r = rpc();
    r.raw.getGenesisHash.mockResolvedValue("other-network");
    expect((await inspect(r)).blockers).toContain("NETWORK_MISMATCH");
    expect(r.raw.getAccountInfo).not.toHaveBeenCalled();
  });
  it("requires the nominated authority and matching refund destination", async () => {
    const report = await inspect(rpc(), {
      expectedAuthority: key(9),
      refundDestination: key(10),
    });
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        "AUTHORITY_MISMATCH",
        "REFUND_DESTINATION_MISMATCH",
      ]),
    );
  });
  it("rejects immutable and substituted program data", async () => {
    const immutable = rpc();
    immutable.d[12] = 0;
    expect((await inspect(immutable)).blockers).toContain("IMMUTABLE_PROGRAM");
    const replaced = rpc();
    key(9).toBuffer().copy(replaced.p, 4);
    expect((await inspect(replaced)).blockers).toContain(
      "INVALID_PROGRAM_DATA",
    );
  });
  it("turns malformed state and RPC outages into blockers without leaking provider secrets", async () => {
    const malformed = rpc();
    malformed.d[12] = 9;
    expect((await inspect(malformed)).blockers).toContain(
      "INVALID_PROGRAM_DATA",
    );
    const r = rpc();
    r.raw.getProgramAccounts.mockRejectedValue(
      new Error("https://rpc.example/secret-token"),
    );
    const report = await inspect(r);
    expect(report.blockers).toContain("RPC_EVIDENCE_UNAVAILABLE");
    expect(JSON.stringify(report)).not.toContain("secret-token");
  });
  it("does not convert an incomplete accounting inventory to a successful report", async () => {
    const f = fixture();
    f[1].pubkey = key(10);
    expect((await inspect(rpc(f))).blockers).toContain(
      "INVALID_ACCOUNT_INVENTORY",
    );
  });
});

describe("conditional DFS successor planning", () => {
  function candidate(): DfsMigrationCandidate {
    return {
      quoteMint: quote,
      recipients: [
        { xIdHash: xIdHash("1"), wallet: key(10), shareBps: 2500 },
        { xIdHash: xIdHash("2"), wallet: key(11), shareBps: 7500 },
      ],
      consentingWallets: [key(10), key(11)],
      dbcStage: "pre-curve",
      dbcFees: "quote-only",
      dammFees: "quote-only",
      otherFeeOrRewardRights: "none",
      vault: {
        address: key(12),
        isPda: true,
        mint: quote,
        totalFunded: 0n,
        feePerShare: 0n,
        users: [
          { wallet: key(10), share: 2500 },
          { wallet: key(11), share: 7500 },
        ],
      },
    };
  }
  it.each(["pre-curve", "graduated-damm-v2"] as const)(
    "allows rehearsing exact bound/consenting quote-only shares at %s",
    (stage) => {
      const c = candidate();
      c.dbcStage = stage;
      expect(planDfsRetirement(c)).toMatchObject({
        candidateForDevnetRehearsal: true,
        safeToClose: false,
        blockers: [],
      });
    },
  );
  it.each([
    "unbound",
    "no-consent",
    "both-mints",
    "future-both-mints",
    "unknown-rewards",
    "wrong-mint",
    "non-pda",
    "altered-shares",
    "extra-recipient",
    "funded",
    "checkpoint",
    "in-progress",
    "one-recipient",
    "duplicate-identity",
  ])("blocks unsafe candidate: %s", (failure) => {
    const c = candidate();
    if (failure === "unbound") c.recipients[0].wallet = null;
    if (failure === "no-consent") c.consentingWallets.pop();
    if (failure === "both-mints") c.dbcFees = "both";
    if (failure === "future-both-mints") c.dammFees = "both";
    if (failure === "unknown-rewards") c.otherFeeOrRewardRights = "unknown";
    if (failure === "wrong-mint") c.vault.mint = base;
    if (failure === "non-pda") c.vault.isPda = false;
    if (failure === "altered-shares") c.vault.users[0].share++;
    if (failure === "extra-recipient")
      c.vault.users.push({ wallet: key(12), share: 1 });
    if (failure === "funded") c.vault.totalFunded = 1n;
    if (failure === "checkpoint") c.vault.feePerShare = 1n;
    if (failure === "in-progress") c.dbcStage = "migration-in-progress";
    if (failure === "one-recipient") {
      c.recipients.pop();
      c.recipients[0].shareBps = 10000;
    }
    if (failure === "duplicate-identity")
      c.recipients[1].xIdHash = c.recipients[0].xIdHash;
    const result = planDfsRetirement(c);
    expect(result.candidateForDevnetRehearsal).toBe(false);
    expect(result.safeToClose).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
  });
});

describe("unused deployment manual review", () => {
  function unused() {
    const config = data("Config", 41);
    authority.toBuffer().copy(config, 8);
    const control = data("Control", 18);
    control[9] = 1;
    control.writeBigUInt64LE(1n, 10);
    const accounts = [
      { pubkey: configAddress(program), account: info(config) },
      { pubkey: controlAddress(program), account: info(control) },
    ];
    const r = rpc(accounts),
      artifact = Buffer.alloc(64, 7);
    const deployed = Buffer.alloc(45 + artifact.length);
    r.d.copy(deployed);
    artifact.copy(deployed, 45);
    deployed.writeBigUInt64LE(20n, 4);
    r.raw.getAccountInfo.mockImplementation(async (address: PublicKey) =>
      address.equals(program)
        ? info(r.p, loader, true)
        : info(deployed, loader),
    );
    const tokenScan = vi.fn(async () => ({
      context: { slot: 42 },
      value: [] as unknown[],
    }));
    const connection = {
      ...r.raw,
      getTokenAccountsByOwner: tokenScan,
    } as unknown as Connection;
    const args = {
      connection,
      program,
      expectedGenesisHash: "expected-genesis",
      expectedAuthority: authority,
      refundDestination: authority,
      reviewedArtifact: artifact,
      reviewedArtifactSha256: createHash("sha256")
        .update(artifact)
        .digest("hex"),
      initialDeploymentSlot: 20,
    };
    return { args, r, accounts, control, deployed, tokenScan };
  }
  it("identifies an exact paused unused deployment only for manual review, never closure approval", async () => {
    const f = unused();
    const result = await inspectUnusedDeployment(f.args);
    expect(result).toMatchObject({
      candidateForManualUnusedClosureReview: true,
      safeToClose: false,
      blockers: [],
    });
    expect(f.tokenScan).toHaveBeenCalledTimes(6);
  });
  it.each([
    "active",
    "no-control",
    "extra-account",
    "wrong-artifact",
    "upgraded",
    "no-provenance",
    "token-account",
    "stale-scan",
    "rpc",
  ])("blocks unused review for %s", async (failure) => {
    const f = unused();
    if (failure === "active") f.control[9] = 0;
    if (failure === "no-control") f.accounts.pop();
    if (failure === "extra-account") f.accounts.push(fixture()[0]);
    if (failure === "wrong-artifact") f.deployed[45] ^= 1;
    if (failure === "upgraded") f.deployed.writeBigUInt64LE(21n, 4);
    if (failure === "no-provenance") f.args.initialDeploymentSlot = 0;
    if (failure === "token-account")
      f.tokenScan.mockResolvedValue({ context: { slot: 42 }, value: [{}] });
    if (failure === "stale-scan")
      f.tokenScan.mockResolvedValue({ context: { slot: 41 }, value: [] });
    if (failure === "rpc")
      f.tokenScan.mockRejectedValue(new Error("private RPC URL"));
    const result = await inspectUnusedDeployment(f.args);
    expect(result.candidateForManualUnusedClosureReview).toBe(false);
    expect(result.safeToClose).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
  });
});
