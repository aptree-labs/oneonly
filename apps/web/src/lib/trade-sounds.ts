export type TradeSound = "buy" | "sell";
export function confirmedTradeSound(intent: {
  status: string;
  kind?: string;
  details: Record<string, string>;
}): TradeSound | null {
  if (intent.status !== "confirmed") return null;
  if (
    intent.kind === "trade" &&
    (intent.details.side === "buy" || intent.details.side === "sell")
  )
    return intent.details.side;
  if (intent.kind === "launch" && intent.details.input) return "buy";
  return null;
}

/** Short, locally synthesized cues: no media download or third-party request. */
export class TradeSounds {
  private context: AudioContext | null = null;
  private voices = new Set<OscillatorNode>();
  enabled = true;
  // Called directly from the wallet approval click, before any async wallet work.
  arm() {
    if (!this.enabled) return;
    try {
      const Constructor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Constructor) return;
      this.context ??= new Constructor();
      if (this.context.state === "suspended")
        void this.context.resume().catch(() => {});
    } catch {
      /* Audio must never interfere with a transaction. */
    }
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }
  private stop() {
    for (const voice of this.voices) {
      try {
        voice.stop();
        voice.disconnect();
      } catch {}
    }
    this.voices.clear();
  }
  play(side: TradeSound) {
    const context = this.context;
    // Skip blocked/background audio; never queue an old success for a later click.
    if (!this.enabled || !context || context.state !== "running") return;
    try {
      this.stop();
      const notes =
        side === "buy"
          ? [523.25, 659.25, 783.99, 1046.5]
          : [783.99, 659.25, 523.25];
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator(),
          gain = context.createGain();
        const start = context.currentTime + index * 0.085;
        oscillator.type = side === "buy" ? "sine" : "triangle";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.09, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.24);
        oscillator.connect(gain);
        gain.connect(context.destination);
        this.voices.add(oscillator);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
          this.voices.delete(oscillator);
        };
        oscillator.start(start);
        oscillator.stop(start + 0.26);
      });
    } catch {
      this.stop();
    }
  }
  dispose() {
    this.stop();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
  }
}
