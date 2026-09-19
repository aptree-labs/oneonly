import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./history-rpc", () => ({ readHistoryReceipt: mock.read }));
import { scanHistory } from "./scan-history";
const receipt = { blockTime: 1, meta: { err: null, logMessages: [] } } as any;
const entries = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ signature: `sig-${i}`, err: null }));
const defaults = () => ({
  rpc: { rpcEndpoint: "https://example.invalid" },
  entries: entries(9),
  cursor: null,
  deadline: Date.now() + 10000,
  visit: vi.fn(async (_signature: string, _receipt: unknown): Promise<boolean | void> => {}),
  checkpoint: vi.fn(async (_cursor: string | null) => {}),
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("pipelines receipts in groups of three and checkpoints them in chain order", async () => {
  vi.useFakeTimers();
  const started = Date.now();
  let active = 0,
    maximum = 0;
  mock.read.mockImplementation(async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 100));
    active--;
    return receipt;
  });
  const options = defaults();
  const work = scanHistory(options);
  await vi.advanceTimersByTimeAsync(300);
  expect(await work).toEqual({ complete: true });
  expect(maximum).toBe(3);
  expect(Date.now() - started).toBe(300);
  expect(options.checkpoint.mock.calls.map((call) => call[0])).toEqual([
    "sig-2",
    "sig-5",
    "sig-8",
  ]);
  expect(options.visit).toHaveBeenCalledTimes(9);
});
it("does not advance past a missing receipt even if later receipts were already stored", async () => {
  mock.read.mockImplementation(async (_rpc, signature) =>
    signature === "sig-1" ? null : receipt,
  );
  const options = defaults();
  expect((await scanHistory(options)).complete).toBe(false);
  expect(options.checkpoint).toHaveBeenLastCalledWith("sig-0");
  expect(mock.read).toHaveBeenCalledTimes(3);
  expect(options.visit.mock.calls.some((call) => call[0] === "sig-2")).toBe(
    true,
  );
});
it("persists progress before an RPC exception and never declares the gap complete", async () => {
  mock.read.mockImplementation(async (_rpc, signature) => {
    if (signature === "sig-4") throw Error("429");
    return receipt;
  });
  const options = defaults();
  expect((await scanHistory(options)).complete).toBe(false);
  expect(options.checkpoint.mock.calls.map((call) => call[0])).toEqual([
    "sig-2",
    "sig-3",
  ]);
  expect(mock.read).toHaveBeenCalledTimes(6);
});
it("stops issuing batches at the deadline and rejects truncated logs", async () => {
  mock.read.mockResolvedValue(receipt);
  const options = defaults();
  options.deadline = Date.now() - 1;
  expect((await scanHistory(options)).complete).toBe(false);
  expect(mock.read).not.toHaveBeenCalled();
  mock.read.mockResolvedValue({
    ...receipt,
    meta: { err: null, logMessages: ["Log truncated"] },
  });
  expect((await scanHistory(defaults())).complete).toBe(false);
  expect(options.visit).not.toHaveBeenCalled();
});
it("keeps the last successful cursor when ingestion fails", async () => {
  mock.read.mockResolvedValue(receipt);
  const options = defaults();
  options.visit.mockImplementation(async (signature: string) => {
    if (signature === "sig-2") throw Error("database failure");
  });
  expect((await scanHistory(options)).complete).toBe(false);
  expect(options.checkpoint).toHaveBeenLastCalledWith("sig-1");
});
it("ends coverage at the initialization receipt, skipping failed transactions", async () => {
  mock.read.mockResolvedValue(receipt);
  const options = {
    ...defaults(),
    entries: [{ signature: "failed", err: { code: 1 } }, ...entries(3)],
    visit: vi.fn(async (signature: string) => signature === "sig-0"),
  };
  expect((await scanHistory(options)).complete).toBe(true);
  expect(options.checkpoint).toHaveBeenLastCalledWith("sig-0");
  expect(mock.read).toHaveBeenCalledTimes(2);
});
