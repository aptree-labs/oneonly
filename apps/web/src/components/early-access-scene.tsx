"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import sceneAssets from "@/lib/scene-assets.json";
import { EarlyAccessShareDialog } from "@/components/early-access-share";

type PoseName = keyof typeof sceneAssets;
type CharacterId = "pee" | "solana" | "rocket" | "dj";
const characters: {
  id: CharacterId;
  rest: PoseName;
  action: PoseName;
  name: string;
  label: string;
  shout: string;
  duration: number;
}[] = [
  {
    id: "pee",
    rest: "pressed",
    action: "pissing",
    name: "The local",
    label: "Let it out",
    shout: "Sweet relief.",
    duration: 5200,
  },
  {
    id: "solana",
    rest: "screen-inspect",
    action: "screen-with-solana",
    name: "The chart watcher",
    label: "Check the charts",
    shout: "SOL good!",
    duration: 4300,
  },
  {
    id: "rocket",
    rest: "rocket-revealed",
    action: "rocket-launched",
    name: "The moon boy",
    label: "Send it",
    shout: "We're so back!",
    duration: 5500,
  },
  {
    id: "dj",
    rest: "dj-calm",
    action: "dj-rocking",
    name: "The resident DJ",
    label: "Drop the beat",
    shout: "Certified banger.",
    duration: 6500,
  },
];
function Arrow({ down = false }: { down?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      aria-hidden="true"
      style={down ? { transform: "rotate(90deg)" } : undefined}
    >
      <path
        d="M4 12h15m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="19"
      height="19"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 9h4l5-4v14l-5-4H4V9Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      {muted ? (
        <path d="m17 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="1.7" />
      ) : (
        <path
          d="M17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
function XIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
      <path
        d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l8.2-9.4L2.8 2h6.4l4.5 6.8L18.9 2ZM17.8 20h1.8L8.2 3.9H6.3L17.8 20Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function EarlyAccessScene() {
  const [active, setActive] = useState<CharacterId | null>(null);
  const [muted, setMuted] = useState(false);
  const [joining, setJoining] = useState(false);
  const [wallet, setWallet] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const [soundMessage, setSoundMessage] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const accessRef = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const soundCache = useRef(new Map<CharacterId, HTMLAudioElement>());
  const poseCache = useRef(new Map<string, HTMLImageElement>());
  const actionSequence = useRef(0);

  useEffect(() => {
    try {
      setMuted(localStorage.getItem("oneonly-muted") === "true");
    } catch {
      /* Storage may be disabled. */
    }
    const observer = new IntersectionObserver(
      ([entry]) => setJoining(entry.isIntersecting),
      { threshold: 0.25 },
    );
    if (accessRef.current) observer.observe(accessRef.current);
    const auth = new URLSearchParams(window.location.search).get("auth");
    if (auth) {
      if (auth === "success") {
        setStatus("success");
        setMessage("Your X account is on the list. See you on the inside.");
        setShareOpen(true);
      } else {
        setStatus("error");
        setMessage(
          auth === "unavailable"
            ? "X connect is coming soon. You can join with your wallet below."
            : auth === "cancelled"
              ? "X connection cancelled. Try again or use your wallet."
              : "We couldn’t connect your X account. Try again or use your wallet.",
        );
      }
      accessRef.current?.scrollIntoView({ behavior: "instant" });
      window.history.replaceState(null, "", "/#early-access");
    }
    const stopSound = () => {
      if (document.hidden) {
        actionSequence.current++;
        audio.current?.pause();
        setActive(null);
      }
    };
    document.addEventListener("visibilitychange", stopSound);
    return () => {
      observer.disconnect();
      actionSequence.current++;
      if (timer.current) clearTimeout(timer.current);
      audio.current?.pause();
      document.removeEventListener("visibilitychange", stopSound);
    };
  }, []);

  useEffect(() => {
    if (!shareOpen) return;
    actionSequence.current++;
    if (timer.current) clearTimeout(timer.current);
    audio.current?.pause();
    setActive(null);
  }, [shareOpen]);

  function warmPose(name: string) {
    let image = poseCache.current.get(name);
    if (!image) {
      image = new window.Image();
      image.srcset = `/scene/${name}-320.webp 320w, /scene/${name}-640.webp 640w`;
      image.sizes = "(max-width: 600px) 45vw, 30vw";
      image.src = `/scene/${name}-640.webp`;
      poseCache.current.set(name, image);
    }
    return image;
  }
  async function play(character: (typeof characters)[number]) {
    const sequence = ++actionSequence.current;
    if (timer.current) clearTimeout(timer.current);
    audio.current?.pause();
    setActive(null);
    setSoundMessage("");
    if (active === character.id) return;
    // Start media in the user gesture; decoding the pose must not consume audio permission.
    if (!muted) {
      let clip = soundCache.current.get(character.id);
      if (!clip) {
        clip = new Audio(
          `/sounds/${character.id === "pee" ? "pee-v2" : character.id}.mp3`,
        );
        clip.volume = 0.55;
        soundCache.current.set(character.id, clip);
      }
      audio.current = clip;
      clip.currentTime = 0;
      void clip.play().catch(() => {
        if (sequence === actionSequence.current)
          setSoundMessage(
            "Sound couldn’t play. Tap the character to try again.",
          );
      });
    }
    try {
      await warmPose(character.action).decode();
    } catch {
      if (sequence === actionSequence.current) {
        audio.current?.pause();
        setSoundMessage("That character couldn’t load. Tap to try again.");
      }
      poseCache.current.delete(character.action);
      return;
    }
    if (sequence !== actionSequence.current) return;
    setActive(character.id);
    timer.current = setTimeout(() => {
      setActive(null);
      audio.current?.pause();
    }, character.duration);
  }
  function toggleSound() {
    const value = !muted;
    setMuted(value);
    try {
      localStorage.setItem("oneonly-muted", String(value));
    } catch {
      /* Muting still works without storage. */
    }
    if (value) audio.current?.pause();
  }
  async function submitWallet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "saving") return;
    setStatus("saving");
    setMessage("");
    try {
      const response = await fetch("/api/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "Couldn’t save your spot. Please try again.",
        );
      setStatus("success");
      setMessage("Your wallet is on the list. See you on the inside.");
      setShareOpen(true);
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error && error.name !== "TimeoutError"
          ? error.message
          : "That took too long. Please try again.",
      );
    }
  }

  return (
    <main className={joining ? "experience is-joining" : "experience"}>
      <a href="#early-access" className="skip-link">
        Skip to early access
      </a>
      <div className="world" aria-hidden="true">
        <picture className="landscape">
          <source
            type="image/avif"
            srcSet="/scene/background-960.avif 960w, /scene/background-1600.avif 1600w, /scene/background-2560.avif 2560w"
            sizes="100vw"
          />
          <img
            src="/scene/background-1600.webp"
            srcSet="/scene/background-960.webp 960w, /scene/background-1600.webp 1600w, /scene/background-2560.webp 2560w"
            sizes="100vw"
            alt=""
            fetchPriority="high"
            width="2560"
            height="1440"
          />
        </picture>
        <div className="sky-wash" />
      </div>
      <header className="topbar">
        <a href="#home" className="brand-logo" aria-label="One Only home">
          <img
            src="/brand/logo-128.webp"
            width="48"
            height="48"
            alt="One Only"
          />
        </a>
        <span className="nav-note">
          <span className="status-dot" /> A little early. A lot degen.
        </span>
        <a className="pill-button" href="#early-access">
          Early Access <Arrow />
        </a>
      </header>
      <div className="cast" aria-label="Meet the locals">
        {characters.map((character) => (
          <button
            key={character.id}
            className={`character character-${character.id}${active === character.id ? " is-active" : ""}`}
            aria-label={`${character.label} — ${character.name}`}
            aria-pressed={active === character.id}
            onClick={() => void play(character)}
            onPointerEnter={() => warmPose(character.action)}
            onFocus={() => warmPose(character.action)}
          >
            <span
              className="character-hit-area"
              style={{
                clipPath:
                  sceneAssets[
                    active === character.id ? character.action : character.rest
                  ].hitArea,
              }}
              aria-hidden="true"
            />
            <img
              width={sceneAssets[character.rest].width}
              height={sceneAssets[character.rest].height}
              className="pose pose-rest"
              src={`/scene/${character.rest}-640.webp`}
              srcSet={`/scene/${character.rest}-320.webp 320w, /scene/${character.rest}-640.webp 640w`}
              sizes="(max-width: 600px) 45vw, 30vw"
              alt=""
              draggable={false}
            />
            {active === character.id && (
              <img
                width={sceneAssets[character.action].width}
                height={sceneAssets[character.action].height}
                className="pose pose-action"
                src={`/scene/${character.action}-640.webp`}
                srcSet={`/scene/${character.action}-320.webp 320w, /scene/${character.action}-640.webp 640w`}
                sizes="(max-width: 600px) 45vw, 30vw"
                alt=""
                draggable={false}
              />
            )}
            <span className="character-caption">
              {active === character.id ? character.shout : character.label}
              <span aria-hidden="true"> ↗</span>
            </span>
          </button>
        ))}
      </div>
      <section id="home" className="hero" aria-labelledby="hero-heading">
        <div className="hero-copy">
          <h1 id="hero-heading">
            <span>One only.</span>
          </h1>
        </div>
        <div className="scribble">
          Go on. Poke a degen.
          <svg viewBox="0 0 68 58" aria-hidden="true">
            <path
              d="M3 4c40-8 54 12 43 43m-14-9 12 13 16-12"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <a
          href="#early-access"
          className="scroll-cue"
          aria-label="Scroll to early access"
        >
          <span>THERE’S ROOM FOR ONE MORE</span>
          <Arrow down />
        </a>
      </section>
      <section
        id="early-access"
        ref={accessRef}
        className="access-section"
        aria-labelledby="access-heading"
      >
        <div className="access-card">
          <span className="tape tape-left" aria-hidden="true" />
          <span className="tape tape-right" aria-hidden="true" />
          <p className="eyebrow">
            <span className="status-dot" /> THE LIST IS OPEN
          </p>
          {status === "success" ? (
            <div className="success-state" role="status">
              <div className="success-mark" aria-hidden="true">
                ✓
              </div>
              <h2 id="access-heading">You’re one of us.</h2>
              <p>{message}</p>
              <button
                className="primary-button"
                onClick={() => setShareOpen(true)}
              >
                Share your spot <XIcon />
              </button>
              <a href="#home" className="primary-button">
                Back to the chaos <Arrow />
              </a>
            </div>
          ) : (
            <>
              <h2 id="access-heading">
                Be early.
                <br />
                <span>Stay degen.</span>
              </h2>
              <p className="access-description">
                Get on the list before we open the gates.
              </p>
              <a href="/api/auth/x" className="x-button">
                <XIcon /> Connect with X <Arrow />
              </a>
              <div className="divider">
                <span>or use your Solana wallet</span>
              </div>
              <form onSubmit={submitWallet}>
                <label htmlFor="wallet">Solana wallet address</label>
                <input
                  id="wallet"
                  name="wallet"
                  placeholder="Your public wallet address"
                  value={wallet}
                  onChange={(event) => {
                    setWallet(event.target.value);
                    if (status === "error") {
                      setStatus("idle");
                      setMessage("");
                    }
                  }}
                  required
                  minLength={32}
                  maxLength={44}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={status === "error" && !!wallet}
                  aria-describedby="wallet-note signup-message"
                  disabled={status === "saving"}
                />
                <button
                  className="primary-button"
                  type="submit"
                  disabled={status === "saving"}
                >
                  {status === "saving" ? "Saving your spot…" : "Count me in"}
                  <Arrow />
                </button>
              </form>
              <p
                id="signup-message"
                className={`form-message ${status === "error" ? "has-error" : ""}`}
                aria-live="polite"
              >
                {message}
              </p>
              <p className="privacy-note" id="wallet-note">
                Just your public address. No wallet connection,
                <br />
                no signatures, no funny business.
              </p>
            </>
          )}
          <div className="card-footer">
            <span>ONE ONLY. ALL DEGEN.</span>
            <span className="solana-lockup">
              <i aria-hidden="true">≋</i> Built on Solana
            </span>
          </div>
        </div>
      </section>
      <footer className="scene-footer">
        <button
          className="sound-button"
          onClick={toggleSound}
          aria-label={
            muted ? "Unmute character sounds" : "Mute character sounds"
          }
          aria-pressed={!muted}
        >
          <SoundIcon muted={muted} />
          <span>SOUND {muted ? "OFF" : "ON"}</span>
        </button>
        <span className="footer-note">NO COPIES. JUST ORIGINALS.</span>
        <span className="footer-year">
          © {new Date().getFullYear()} ONE ONLY
        </span>
      </footer>
      <span className="sr-only" aria-live="polite">
        {soundMessage}
      </span>
      {shareOpen && (
        <EarlyAccessShareDialog onClose={() => setShareOpen(false)} />
      )}
    </main>
  );
}
