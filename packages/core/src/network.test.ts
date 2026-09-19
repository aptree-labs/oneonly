import { expect, it } from "vitest";
import {
  solanaNetwork,
  GENESIS_HASHES,
  walletChain,
  explorerUrl,
} from "./network";

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
