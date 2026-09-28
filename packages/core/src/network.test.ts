import { expect, it } from "vitest";
import {
  solanaNetwork,
  GENESIS_HASHES,
  walletChain,
  explorerUrl,
  deploymentScope,
  walletSessionCookieName,
} from "./network";

it("prevents a staging runtime from selecting mainnet", () => {
  expect(solanaNetwork("devnet", "staging")).toBe("devnet");
  expect(() => solanaNetwork("mainnet-beta", "staging")).toThrow("devnet");
  expect(() => solanaNetwork(undefined, "staging")).toThrow("devnet");
});

it("rejects ambiguous networks and keeps wallet chains distinct from genesis hashes", () => {
  expect(solanaNetwork(undefined)).toBe("devnet");
  expect(solanaNetwork("mainnet-beta")).toBe("mainnet-beta");
  expect(() => solanaNetwork("mainnet")).toThrow();
  expect(() => solanaNetwork("")).toThrow();
  expect(walletChain("mainnet-beta")).toBe("solana:mainnet");
  expect(GENESIS_HASHES["mainnet-beta"]).toBe(
    "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  );
  expect(explorerUrl("mainnet-beta", "tx", "signature")).toBe(
    "https://explorer.solana.com/tx/signature",
  );
  expect(explorerUrl("devnet", "address", "mint")).toContain("?cluster=devnet");
});

it("requires an exact explicit opt-in for staging mainnet", () => {
  expect(solanaNetwork("mainnet-beta", "staging", "true")).toBe("mainnet-beta");
  for (const flag of [undefined, "false", "1", "TRUE", " true "])
    expect(() => solanaNetwork("mainnet-beta", "staging", flag)).toThrow(
      "STAGING_MAINNET_ENABLED",
    );
  expect(() => solanaNetwork(undefined, "staging", "true")).toThrow();
  expect(solanaNetwork("devnet", "staging", "true")).toBe("devnet");
});
it("isolates both staging networks without changing production cookie scopes", () => {
  expect(deploymentScope("mainnet-beta", "staging")).toBe(
    "staging-mainnet-beta",
  );
  expect(deploymentScope("devnet", "staging")).toBe("staging-devnet");
  expect(deploymentScope("mainnet-beta", "production")).toBe("mainnet-beta");
  expect(walletSessionCookieName("mainnet-beta", "staging")).toBe(
    "oneonly-wallet-staging-mainnet-beta",
  );
  expect(walletSessionCookieName("mainnet-beta")).toBe(
    "oneonly-wallet-mainnet-beta",
  );
});
