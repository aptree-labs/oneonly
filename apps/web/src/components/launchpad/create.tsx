"use client";
import Link from "next/link";
import { Select } from "./select";
import { useEffect, useState, type FormEvent } from "react";
import {
  ImagePlus,
  ArrowUpRight,
  Check,
  LoaderCircle,
  BadgeCheck,
} from "lucide-react";
import { api, useLaunchpad, type Intent } from "./provider";
import { normalizeAmount, amountReference } from "@oneonly/core";
type Config = {
  quotes: {
    symbol: string;
    name?: string;
    category?: string;
    enabled: boolean;
    creationEnabled?: boolean;
    displayUsdPrice?: number | null;
    reason?: string | null;
  }[];
  prices: Record<string, number> | null;
};
export function CreateToken({
  initialTicker = "",
  initialQuote = "SOL",
}: {
  initialTicker?: string;
  initialQuote?: string;
}) {
  const app = useLaunchpad(),
    [config, setConfig] = useState<Config | null>(null),
    [ticker, setTicker] = useState(initialTicker),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [website, setWebsite] = useState(""),
    [xUrl, setXUrl] = useState(""),
    [xSource, setXSource] = useState<"link" | "connected">("link"),
    [telegram, setTelegram] = useState(""),
    [discord, setDiscord] = useState(""),
    [profileBusy, setProfileBusy] = useState(false),
    [profileError, setProfileError] = useState(""),
    [quote, setQuote] = useState(initialQuote),
    [payment, setPayment] = useState("SOL"),
    [initialBuy, setInitialBuy] = useState(""),
    [includeFirstBuy, setIncludeFirstBuy] = useState(false),
    [slippage, setSlippage] = useState("1"),
    [image, setImage] = useState(""),
    [availability, setAvailability] = useState(""),
    [existingToken, setExistingToken] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    api<Config>("config")
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    setXSource("link");
    setProfileError("");
  }, [app.wallet]);
  async function useConnectedX() {
    setProfileBusy(true);
    setProfileError("");
    try {
      await app.authenticate();
      const { profile } = await api<{ profile: { username: string } | null }>(
        "profile",
      );
      if (!profile)
        throw new Error(
          "Connect X using the top bar first, then choose your connected account here.",
        );
      setXUrl(`https://x.com/${profile.username}`);
      setXSource("connected");
    } catch (error) {
      setProfileError((error as Error).message);
    } finally {
      setProfileBusy(false);
    }
  }
  useEffect(() => {
    setAvailability("");
    setExistingToken(null);
    if (!ticker) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<{
        available: boolean;
        ticker: string;
        tokenId?: string;
        reserved?: boolean;
      }>(`ticker?value=${encodeURIComponent(ticker)}`)
        .then((data) => {
          if (!controller.signal.aborted) {
            setAvailability(
              data.reserved
                ? "Reserved for One Only"
                : data.available
                  ? "Available"
                  : "Already claimed",
            );
            setExistingToken(data.tokenId ?? null);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) setAvailability(e.message);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [ticker]);
  async function selectImage(file: File | undefined) {
    if (!file) return;
    setError("");
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 10_000_000
    ) {
      setError("Choose a PNG, JPEG, or WebP under 10 MB.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file),
        canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const context = canvas.getContext("2d")!;
      const side = Math.min(bitmap.width, bitmap.height);
      context.drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        0,
        0,
        512,
        512,
      );
      bitmap.close();
      setImage(canvas.toDataURL("image/webp", 0.82));
    } catch {
      setError("That image could not be loaded.");
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await app.authenticate();
      if (!image) throw new Error("Choose an image for your token.");
      const uploaded = await api<{ id: string }>("image", {
        data: image.split(",")[1],
      });
      const intent = await api<Intent>("launch", {
        ticker,
        name,
        description,
        website,
        xUrl,
        xSource,
        telegram,
        discord,
        imageId: uploaded.id,
        quote,
        initialBuy: includeFirstBuy ? normalizeAmount(initialBuy) : "0",
        payment,
        slippageBps: Number(slippage) * 100,
      });
      app.review(intent);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selectedAsset = config?.quotes.find((item) => item.symbol === quote);
  const enabled = includeFirstBuy
      ? selectedAsset?.enabled
      : (selectedAsset?.creationEnabled ?? selectedAsset?.enabled),
    price = config?.quotes.find(
      (item) => item.symbol === payment,
    )?.displayUsdPrice;
  const reference = amountReference(initialBuy, price);
  return (
    <>
      <div className="lp-page-heading">
        <span className="lp-kicker">FROM IDEA TO ON-CHAIN</span>
        <h1>
          Ready to <em>send it?</em>
        </h1>
        <p>
          Pick your identity. Launch your token. Let the market take it from
          there.
        </p>
      </div>
      <div className="lp-create-grid">
        <form className="lp-panel lp-create-form" onSubmit={submit}>
          <div className="lp-section-heading">
            <h2>The identity</h2>
            <span>Image, name & ticker required</span>
          </div>
          <label className={`lp-upload ${image ? "has-image" : ""}`}>
            {image ? (
              <img src={image} alt="Token image preview" />
            ) : (
              <>
                <ImagePlus size={29} />
                <strong>Give it a face</strong>
                <span>PNG, JPEG or WebP · square crop</span>
              </>
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="Token image"
              onChange={(e) => void selectImage(e.target.files?.[0])}
            />
            {image && <span className="lp-upload-change">Change image</span>}
          </label>
          <div className="lp-form-row">
            <label>
              Token name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Something unforgettable"
                required
                maxLength={32}
              />
            </label>
            <label>
              Ticker
              <div className="lp-input-prefix">
                <span>$</span>
                <input
                  value={ticker}
                  onChange={(e) =>
                    setTicker(
                      e.target.value.replace(/[a-z]/g, (letter) =>
                        letter.toUpperCase(),
                      ),
                    )
                  }
                  placeholder="YOURS"
                  required
                  maxLength={12}
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </div>
              <span
                className={
                  availability === "Available" ? "lp-valid" : "lp-muted"
                }
                aria-live="polite"
              >
                {availability || "1–10 letters or numbers"}
                {existingToken && (
                  <>
                    {" "}
                    ·{" "}
                    <Link href={`/app/token/${existingToken}`}>View token</Link>
                  </>
                )}
              </span>
            </label>
          </div>
          <label>
            The story (optional)
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What should people know about your token?"
              maxLength={500}
              rows={4}
            />
            <span className="lp-caption">{description.length}/500</span>
          </label>
          <div className="lp-section-heading lp-separated">
            <h2>Project links</h2>
            <span>Optional</span>
          </div>
          <div className="lp-project-fields">
            <label>
              Website
              <input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://yourproject.com"
                maxLength={500}
                autoCapitalize="none"
                spellCheck={false}
                inputMode="url"
              />
            </label>
            <label>
              X account
              <input
                value={xUrl}
                onChange={(e) => {
                  setXUrl(e.target.value);
                  setXSource("link");
                }}
                placeholder="https://x.com/yourproject"
                maxLength={500}
                autoCapitalize="none"
                spellCheck={false}
                inputMode="url"
              />
            </label>
            <div className="lp-project-x-choice">
              <button
                type="button"
                className="lp-secondary"
                onClick={() => void useConnectedX()}
                disabled={profileBusy || busy}
              >
                {profileBusy ? (
                  <LoaderCircle size={15} className="lp-spin" />
                ) : (
                  <BadgeCheck size={15} />
                )}{" "}
                {xSource === "connected"
                  ? "Connected X selected"
                  : "Use connected X account"}
              </button>
              {xSource === "connected" && (
                <span className="lp-valid">Verified creator account</span>
              )}
            </div>
            {profileError && (
              <p className="lp-error" role="alert">
                {profileError}
              </p>
            )}
            <div className="lp-form-row">
              <label>
                Telegram
                <input
                  value={telegram}
                  onChange={(e) => setTelegram(e.target.value)}
                  placeholder="https://t.me/yourproject"
                  maxLength={500}
                  autoCapitalize="none"
                  spellCheck={false}
                  inputMode="url"
                />
              </label>
              <label>
                Discord
                <input
                  value={discord}
                  onChange={(e) => setDiscord(e.target.value)}
                  placeholder="https://discord.gg/invite"
                  maxLength={500}
                  autoCapitalize="none"
                  spellCheck={false}
                  inputMode="url"
                />
              </label>
            </div>
          </div>
          <div className="lp-section-heading lp-separated">
            <h2>The launch</h2>
            <span>First buy optional</span>
          </div>
          <div>
            <label>
              Pair with
              <Select
                label="Pair with"
                value={quote}
                searchable
                onChange={(value) => {
                  setQuote(value);
                  setPayment("SOL");
                  setInitialBuy("");
                }}
                options={(
                  config?.quotes ?? [
                    { symbol: "SOL", enabled: false },
                    { symbol: "USDC", enabled: false },
                  ]
                ).map((asset) => ({
                  value: asset.symbol,
                  label: asset.symbol,
                  description: (
                    includeFirstBuy
                      ? asset.enabled
                      : "creationEnabled" in asset
                        ? asset.creationEnabled
                        : asset.enabled
                  )
                    ? "Available for launch"
                    : "Currently unavailable",
                }))}
              />
            </label>
          </div>
          <button
            type="button"
            className="lp-secondary"
            aria-expanded={includeFirstBuy}
            aria-controls="launch-first-buy"
            onClick={() => setIncludeFirstBuy((value) => !value)}
          >
            {includeFirstBuy ? "Remove first buy" : "Add a first buy"}
          </button>
          {!includeFirstBuy && (
            <p className="lp-caption">
              Anyone can make the first purchase. You only pay creation rent and
              network fees.
            </p>
          )}
          {includeFirstBuy && (
            <div id="launch-first-buy" className="lp-optional-first-buy">
              <label>
                Amount ({payment})
                <input
                  value={initialBuy}
                  onChange={(e) => setInitialBuy(e.target.value)}
                  placeholder={
                    price
                      ? `At least ${(Math.ceil((5 / price + 0.00000001) * 1e6) / 1e6).toFixed(6)}`
                      : "Enter amount"
                  }
                  inputMode="decimal"
                  required
                />
                <span className="lp-caption">
                  {reference !== null
                    ? `≈ $${reference} reference value`
                    : "Plus network fees and account rent"}
                </span>
              </label>
              <p className="lp-caption">Minimum $5 reference value.</p>
              {quote !== "SOL" && (
                <label>
                  Pay with
                  <Select
                    label="Pay with"
                    value={payment}
                    onChange={(value) => {
                      setPayment(value);
                      setInitialBuy("");
                    }}
                    options={[
                      {
                        value: "SOL",
                        label: "SOL",
                        description: "Convert automatically",
                      },
                      {
                        value: quote,
                        label: quote,
                        description: "Use my balance",
                      },
                    ]}
                  />
                  <span className="lp-caption">
                    {payment === "SOL"
                      ? `SOL converts to ${quote} before your first buy. Review both steps and their fees before signing.`
                      : `Your token will be paired with ${quote}.`}
                  </span>
                </label>
              )}
              <label>
                Slippage tolerance
                <Select
                  label="Slippage tolerance"
                  value={slippage}
                  onChange={setSlippage}
                  options={["0.5", "1", "3", "5"].map((value) => ({
                    value,
                    label: `${value}%`,
                  }))}
                />
              </label>
            </div>
          )}
          {config && !enabled && (
            <p className="lp-notice">
              {config.quotes.find((asset) => asset.symbol === quote)?.reason ??
                "This pair is not available for new launches."}
            </p>
          )}
          {error && (
            <p className="lp-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="lp-primary lp-full"
            disabled={busy || !enabled || availability !== "Available"}
          >
            {busy ? (
              <LoaderCircle size={18} className="lp-spin" />
            ) : (
              <ArrowUpRight size={18} />
            )}{" "}
            {busy ? "Preparing your launch…" : "Review launch"}
          </button>
          <p className="lp-caption">
            No transaction is sent until you approve it in your wallet.
          </p>
        </form>
        <aside className="lp-create-aside">
          <div className="lp-preview-card">
            <span className="lp-kicker">YOUR TOKEN, AT A GLANCE</span>
            <div className="lp-preview-image">
              {image ? <img src={image} alt="" /> : <span>?</span>}
            </div>
            <h2>${ticker.replace(/^\$/, "").toUpperCase() || "YOURS"}</h2>
            <p>{name || "Your token name"}</p>
            <span className="lp-tag">{quote} PAIR</span>
          </div>
          <div className="lp-panel lp-facts">
            <h3>The ground rules</h3>
            {[
              "1 billion tokens. Fixed supply.",
              "First buy is optional. Anyone can buy after launch.",
              "1.25% trading fee on the curve.",
              "Creator earns 0.5% of curve trades.",
              "Graduates into Meteora DAMM v2.",
            ].map((text) => (
              <p key={text}>
                <Check size={16} />
                {text}
              </p>
            ))}
            <div className="lp-fact-note">
              Below $100 daily volume in every pool for three complete UTC days?
              The ticker is released. Your token and its trading history remain.
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
