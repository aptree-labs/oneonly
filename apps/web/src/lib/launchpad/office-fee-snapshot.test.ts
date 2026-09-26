import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), decode: vi.fn() }));
vi.mock("@oneonly/protocol", async (original) => ({
  ...(await original<typeof import("@oneonly/protocol")>()),
  connection: () => ({ getMultipleAccountsInfo: mocks.read }),
  client: () => ({ state: { program: { coder: { accounts: { decode: mocks.decode } } } } }),
}));
vi.mock("./history-rpc", () => ({ historyConnection: () => ({ getMultipleAccountsInfo: mocks.read }) }));
import { PublicKey, PROGRAM } from "@oneonly/protocol";
import { curveFeeAmounts, readCurveFeeSnapshot } from "./office-fee-snapshot";

it("keeps lifetime revenue and paid claims separate from outstanding fees", () => {
  const state = { metrics: { totalTradingBaseFee: 0n, totalTradingQuoteFee: 10001n }, creatorQuoteFee: 1500n };
  expect(curveFeeAmounts(state, { creatorTradingFeePercentage: 50 })).toEqual({ revenue: 5001n, creatorPayouts: 3500n });
  expect(curveFeeAmounts({ ...state, creatorQuoteFee: 0n }, { creatorTradingFeePercentage: 50 })).toEqual({ revenue: 5001n, creatorPayouts: 5000n });
  expect(curveFeeAmounts({ ...state, creatorQuoteFee: 6000n }, { creatorTradingFeePercentage: 50 })).toEqual({ revenue: 5001n, creatorPayouts: 0n });
});
it("batches shared configs and refuses a partial snapshot instead of returning a smaller total", async () => {
  const key = PublicKey.default.toBase58();
  const config = PROGRAM.toBase58();
  const poolState = { config: new PublicKey(config), metrics: { totalTradingBaseFee: 0n, totalTradingQuoteFee: 100n }, creatorQuoteFee: 0n };
  mocks.read.mockResolvedValueOnce([{ owner: PROGRAM, data: Buffer.from([1]) }, { owner: PROGRAM, data: Buffer.from([2]) }]);
  mocks.decode.mockReturnValueOnce({ poolState }).mockReturnValueOnce({ creatorTradingFeePercentage: 50 });
  expect(await readCurveFeeSnapshot([{ id: "one", pool: key, config }])).toEqual([{ id: "one", revenue: 50n, creatorPayouts: 50n }]);
  expect(mocks.read.mock.calls[0][0]).toHaveLength(2);
  mocks.read.mockResolvedValueOnce([{ owner: PROGRAM, data: Buffer.from([1]) }, null]);
  mocks.decode.mockReturnValueOnce({ poolState });
  await expect(readCurveFeeSnapshot([{ id: "one", pool: key, config }])).rejects.toThrow("unavailable");
});
