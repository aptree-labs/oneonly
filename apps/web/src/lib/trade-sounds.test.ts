import { afterEach, expect, it, vi } from "vitest";
import { TradeSounds, confirmedTradeSound } from "./trade-sounds";
function fakeAudio(state = "running") {
  const frequencies: number[] = [];
  const stops = vi.fn();
  const context = {
    state,
    currentTime: 0,
    destination: {},
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    createGain: () => ({
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    createOscillator: () => ({
      type: "sine",
      frequency: { setValueAtTime: (n: number) => frequencies.push(n) },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: stops,
      onended: null,
    }),
  };
  vi.stubGlobal("window", {
    AudioContext: function () {
      return context;
    },
  });
  return { context, frequencies, stops };
}
afterEach(() => vi.unstubAllGlobals());
it("only confirmed buy/sell or an included launch purchase have a sound", () => {
  for (const status of ["prepared", "submitted", "failed", "expired"])
    expect(
      confirmedTradeSound({ status, kind: "trade", details: { side: "buy" } }),
    ).toBeNull();
  expect(
    confirmedTradeSound({
      status: "confirmed",
      kind: "trade",
      details: { side: "sell" },
    }),
  ).toBe("sell");
  expect(
    confirmedTradeSound({
      status: "confirmed",
      kind: "launch",
      details: { input: "0.1 SOL" },
    }),
  ).toBe("buy");
  for (const kind of ["claim", "launch-conversion", "launch"])
    expect(
      confirmedTradeSound({ status: "confirmed", kind, details: {} }),
    ).toBeNull();
});
it("distinct cues only play after gesture arming, and muting stops/suppresses playback", () => {
  const { frequencies, stops } = fakeAudio();
  const sounds = new TradeSounds();
  sounds.play("buy");
  expect(frequencies).toEqual([]);
  sounds.arm();
  sounds.play("buy");
  expect(frequencies).toEqual([523.25, 659.25, 783.99, 1046.5]);
  sounds.play("sell");
  expect(frequencies.slice(-3)).toEqual([783.99, 659.25, 523.25]);
  const before = stops.mock.calls.length;
  sounds.setEnabled(false);
  expect(stops.mock.calls.length).toBeGreaterThan(before);
  sounds.play("buy");
  expect(frequencies).toHaveLength(7);
  sounds.dispose();
});
it("unsupported, blocked or broken audio never throws into trading", () => {
  vi.stubGlobal("window", {});
  const sounds = new TradeSounds();
  expect(() => {
    sounds.arm();
    sounds.play("sell");
  }).not.toThrow();
  const { frequencies } = fakeAudio("suspended");
  sounds.arm();
  sounds.play("buy");
  expect(frequencies).toEqual([]);
  sounds.dispose();
});
