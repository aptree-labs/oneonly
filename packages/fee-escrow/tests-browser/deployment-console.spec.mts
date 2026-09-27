import { test, expect } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair, Transaction } from "@solana/web3.js";
import {
  createDeploymentManifest,
  DEPLOYMENT_GENESIS,
  UPGRADEABLE_LOADER,
} from "../src/deployment";
import {
  startDeploymentConsole,
  type ConsoleRpc,
} from "../scripts/deployment-console";

test("reviews, cancels and signs a devnet step, then blocks duplicate approvals while pending", async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), "oneonly-deploy-browser-"));
  const wallet = Keypair.generate(),
    program = Keypair.generate(),
    buffer = Keypair.generate();
  const artifact = Buffer.alloc(100, 7);
  Buffer.from([127, 69, 76, 70]).copy(artifact);
  let sends = 0,
    approvals = 0;
  const rpc = {
    getGenesisHash: async () => DEPLOYMENT_GENESIS.devnet,
    getMultipleAccountsInfo: async (keys: unknown[]) => keys.map(() => null),
    getMinimumBalanceForRentExemption: async () => 1000,
    getLatestBlockhash: async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 200,
    }),
    getFeeForMessage: async () => ({ value: 5000 }),
    getBlockHeight: async () => 100,
    getSignatureStatuses: async () => ({ value: [null] }),
    getTransaction: async () => null,
    sendRawTransaction: async () => {
      sends++;
      throw new Error("Simulated uncertain confirmation");
    },
  } as unknown as ConsoleRpc;
  const manifest = createDeploymentManifest({
    network: "devnet",
    artifact,
    wallet: wallet.publicKey,
    program: program.publicKey,
    buffer: buffer.publicKey,
    maxTotalLamports: 100000n,
    maxFeePerTransactionLamports: 10000n,
  });
  const local = await startDeploymentConsole({
    rpc,
    manifest,
    artifact,
    localKeys: { program, buffer },
    stateDirectory: directory,
  });
  try {
    // Test-only wallet signs generated test keys. No extension or user wallet is touched.
    await page.exposeFunction("signTestDeployment", (bytes: number[]) => {
      approvals++;
      const tx = Transaction.from(Buffer.from(bytes));
      tx.partialSign(wallet);
      return [...tx.serialize()];
    });
    await page.addInitScript(
      ({ address }) => {
        const account = { address, chains: ["solana:devnet"] };
        const mockWallet = {
          name: "Jupiter Test",
          features: {
            "standard:connect": {
              connect: async () => ({ accounts: [account] }),
            },
            "solana:signTransaction": {
              signTransaction: async (input: any) => [
                {
                  signedTransaction: new Uint8Array(
                    await (window as any).signTestDeployment([
                      ...input.transaction,
                    ]),
                  ),
                },
              ],
            },
          },
        };
        window.addEventListener("wallet-standard:app-ready", (event: any) =>
          event.detail.register(mockWallet),
        );
      },
      { address: wallet.publicKey.toBase58() },
    );
    await page.goto(JSON.parse(readFileSync(local.accessPath, "utf8")).url);
    await expect(page.getByRole("status")).toContainText("Local plan loaded");
    await expect(
      page.getByRole("button", { name: "Review next step" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Connect Jupiter" }).click();
    await page
      .getByLabel("I checked the artifact hash, network, authority and budget.")
      .check();
    await page.getByRole("button", { name: "Review next step" }).click();
    await expect(
      page.getByRole("heading", { name: "Approve this step" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel preparation" }).click();
    expect(approvals).toBe(0);
    expect(sends).toBe(0);
    await page.getByRole("button", { name: "Review next step" }).click();
    await page.getByRole("button", { name: "Approve in Jupiter" }).click();
    await expect(page.locator("#progress")).toContainText(
      "Waiting for finality",
    );
    await expect(
      page.getByRole("button", { name: "Review next step" }),
    ).toBeDisabled();
    expect(approvals).toBe(1);
    expect(sends).toBe(1);
    const saved = JSON.parse(
      readFileSync(join(directory, "journal.json"), "utf8"),
    );
    expect(saved.entries).toHaveLength(1);
    expect(
      Transaction.from(
        Buffer.from(saved.entries[0].signedTransaction, "base64"),
      ).verifySignatures(),
    ).toBe(true);
    await page.getByRole("button", { name: "Check status" }).click();
    expect(sends).toBe(1);
    expect(approvals).toBe(1);
    await expect(
      page.getByRole("button", { name: "Rebroadcast pending" }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await local.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
for (const partial of [false, true]) {
  test(`uses advertised batch signing and ${partial ? "rejects partial wallet results with explicit fallback" : "durably saves the full batch before an uncertain send"}`, async ({
    page,
  }) => {
    const directory = mkdtempSync(join(tmpdir(), "oneonly-batch-browser-")),
      wallet = Keypair.generate(),
      program = Keypair.generate(),
      buffer = Keypair.generate();
    const artifact = Buffer.alloc(3000, 9);
    Buffer.from([127, 69, 76, 70]).copy(artifact);
    const data = Buffer.alloc(3037);
    data.writeUInt32LE(1);
    data[4] = 1;
    wallet.publicKey.toBuffer().copy(data, 5);
    let sends = 0,
      approvals = 0,
      approvedCount = 0;
    const rpc = {
      getGenesisHash: async () => DEPLOYMENT_GENESIS.devnet,
      getMultipleAccountsInfo: async (keys: any[]) =>
        keys.map((key) =>
          key.equals(buffer.publicKey)
            ? {
                data,
                lamports: 1000,
                executable: false,
                rentEpoch: 0,
                owner: UPGRADEABLE_LOADER,
              }
            : null,
        ),
      getMinimumBalanceForRentExemption: async () => 1000,
      getLatestBlockhash: async () => ({
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 200,
      }),
      getFeeForMessage: async () => ({ value: 5000 }),
      getBlockHeight: async () => 100,
      getSignatureStatuses: async (signatures: string[]) => ({
        value: signatures.map(() => null),
      }),
      getTransaction: async () => null,
      sendRawTransaction: async () => {
        sends++;
        expect(
          JSON.parse(readFileSync(join(directory, "journal.json"), "utf8"))
            .entries,
        ).toHaveLength(4);
        throw new Error("uncertain");
      },
    } as unknown as ConsoleRpc;
    const manifest = createDeploymentManifest({
      network: "devnet",
      artifact,
      wallet: wallet.publicKey,
      program: program.publicKey,
      buffer: buffer.publicKey,
      maxTotalLamports: 1_000_000n,
      maxFeePerTransactionLamports: 10000n,
    });
    const local = await startDeploymentConsole({
      rpc,
      manifest,
      artifact,
      localKeys: { program, buffer },
      stateDirectory: directory,
    });
    try {
      await page.exposeFunction("signTestBatch", (items: number[][]) => {
        approvals++;
        approvedCount = items.length;
        return (partial ? items.slice(0, -1) : items).map((bytes) => {
          const tx = Transaction.from(Buffer.from(bytes));
          tx.partialSign(wallet);
          return [...tx.serialize()];
        });
      });
      await page.addInitScript(
        ({ address }) => {
          const account = {
            address,
            chains: ["solana:devnet"],
            features: ["solana:signTransaction"],
          };
          const wallet = {
            name: "Jupiter Test",
            features: {
              "standard:connect": {
                connect: async () => ({ accounts: [account] }),
              },
              "solana:signTransaction": {
                version: "1.0.0",
                supportedTransactionVersions: ["legacy"],
                signTransaction: async (...inputs: any[]) =>
                  (
                    (await (window as any).signTestBatch(
                      inputs.map((input) => [...input.transaction]),
                    )) as number[][]
                  ).map((bytes) => ({
                    signedTransaction: new Uint8Array(bytes),
                  })),
              },
            },
          };
          window.addEventListener("wallet-standard:app-ready", (event: any) =>
            event.detail.register(wallet),
          );
        },
        { address: wallet.publicKey.toBase58() },
      );
      await page.goto(JSON.parse(readFileSync(local.accessPath, "utf8")).url);
      await page.getByRole("button", { name: "Connect Jupiter" }).click();
      await page.locator("#reviewed").check();
      await expect(page.locator("#batch")).toBeChecked();
      await page.getByRole("button", { name: "Review next step" }).click();
      await expect(page.locator("#step")).toContainText("write-batch");
      await page.getByRole("button", { name: "Approve in Jupiter" }).click();
      expect(approvals).toBe(1);
      expect(approvedCount).toBe(4);
      if (partial) {
        await expect(page.getByRole("status")).toContainText(
          "incomplete batch",
        );
        expect(sends).toBe(0);
        await page.getByRole("button", { name: "Cancel preparation" }).click();
        await page.locator("#batch").uncheck();
        await page.getByRole("button", { name: "Review next step" }).click();
        await expect(page.locator("#step")).not.toContainText("write-batch");
      } else {
        await expect(page.getByRole("status")).toContainText(
          "Saved every signed transaction",
        );
        expect(sends).toBe(1);
        await expect(
          page.getByRole("button", { name: "Review next step" }),
        ).toBeDisabled();
      }
    } finally {
      await local.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
