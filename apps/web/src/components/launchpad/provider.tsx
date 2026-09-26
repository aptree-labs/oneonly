"use client";
import {
  walletChain,
  publicRpc,
  explorerUrl,
  formatNumber,
  formatReviewValue,
  type SolanaNetwork,
} from "@oneonly/core";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import {
  WalletModalProvider,
  useWalletModal,
} from "@solana/wallet-adapter-react-ui";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import bs58 from "bs58";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Compass,
  Rocket,
  Wallet,
  X,
  Check,
  ExternalLink,
  LoaderCircle,
  Sun,
  Moon,
  Building2,
  Trophy,
  BookOpen,
  MessageCircle,
  Volume2,
  VolumeX,
} from "lucide-react";
import "@solana/wallet-adapter-react-ui/styles.css";
import { clearMarket } from "@/lib/market-results";
const PurchaseShare = dynamic(
  () => import("./purchase-share").then((module) => module.PurchaseShare),
  { ssr: false },
);
import { supportUrl } from "@/lib/support";
import { XAccountButton } from "./x-account-button";
import { usePanelState } from "./use-panel-state";
import { useTradeSounds } from "./use-trade-sounds";
import { confirmedTradeSound } from "@/lib/trade-sounds";
import { ApiError, tradeSubmissionFailure } from "@/lib/trade-submission";
// Browser extensions and remembered wallets are unavailable during SSR.
const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (module) => module.WalletMultiButton,
    ),
  {
    ssr: false,
    loading: () => (
      <button
        className="wallet-adapter-button wallet-adapter-button-trigger"
        disabled
      >
        Select Wallet
      </button>
    ),
  },
);
export async function api<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(
    `/api/launchpad/${path}`,
    body === undefined
      ? { cache: "default" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json().catch(() => {
    throw new Error(
      "The app service is temporarily unavailable. Try again shortly.",
    );
  });
  if (!response.ok)
    throw new ApiError(
      data.error || "Couldn’t complete that request.",
      response.status,
    );
  return data as T;
}
export type Intent = {
  kind?: string;
  id: string;
  transaction?: string;
  details: Record<string, string>;
  tokenId?: string;
  status: string;
  signature?: string;
  error?: string;
};
export type Theme = "dark" | "light";
type AppContext = {
  theme: Theme;
  network: SolanaNetwork;
  explorer: (kind: "tx" | "address", value: string) => string;
  authenticate: () => Promise<string>;
  review: (intent: Intent) => void;
  executeTrade: (intent: Intent) => Promise<void>;
  tradePending: boolean;
  wallet: string | null;
  transactionRevision: number;
  lastConfirmedTrade: { id: string; tokenId: string } | null;
  notice: string;
  setNotice: (message: string) => void;
};
const Context = createContext<AppContext>(null!);
export const useLaunchpad = () => useContext(Context);
export const short = (address: string) =>
  `${address.slice(0, 4)}…${address.slice(-4)}`;
export const number = formatNumber;
function Shell({
  children,
  network,
  initialTheme,
}: {
  children: ReactNode;
  network: SolanaNetwork;
  initialTheme: Theme;
}) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const tradeSounds = useTradeSounds();
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.cookie = `oneonly-theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }
  const chain = walletChain(network);
  const intentStorageKey = `oneonly-intent-${network}`;
  const wallet = useWallet(),
    modal = useWalletModal(),
    pathname = usePathname();
  const [notice, setNotice] = useState(""),
    [intent, setIntent] = useState<Intent | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [transactionRevision, setTransactionRevision] = useState(0);
  const [lastConfirmedTrade, setLastConfirmedTrade] = useState<{
    id: string;
    tokenId: string;
  } | null>(null);
  const [directTrade, setDirectTrade] = useState(false);
  const signing = useRef(false);
  const [success, setSuccess] = useState<Intent | null>(null);
  const [purchase, setPurchase] = useState<Intent | null>(null);
  const notified = useRef(new Set<string>());
  useEffect(() => {
    if (
      !intent ||
      intent.status !== "confirmed" ||
      intent.kind === "launch-conversion" ||
      notified.current.has(intent.id)
    )
      return;
    notified.current.add(intent.id);
    const sound = confirmedTradeSound(intent);
    if (sound) tradeSounds.sounds.play(sound);
    sessionStorage.removeItem(intentStorageKey);
    setSuccess(intent);
    if (intent.kind === "trade" && intent.tokenId)
      setLastConfirmedTrade({ id: intent.id, tokenId: intent.tokenId });
    if (
      intent.kind === "trade" &&
      ["buy", "sell"].includes(intent.details.side) &&
      intent.tokenId
    )
      setPurchase(intent);
    clearMarket();
    setTransactionRevision((value) => value + 1);
    setIntent(null);
    setError("");
  }, [intent]);
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 10_000);
    return () => clearTimeout(timer);
  }, [success]);
  const [navCollapsed, toggleNavigation] = usePanelState("oneonly-navigation");
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!intent || directTrade) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [!!intent, directTrade]);
  const address = wallet.publicKey?.toBase58() ?? null;
  async function authenticate() {
    if (!address) {
      modal.setVisible(true);
      throw new Error("Connect your wallet, then try again.");
    }
    const current = await api<{ wallet: string | null }>("session");
    if (current.wallet === address) return address;
    if (!wallet.signMessage)
      throw new Error(
        "This wallet cannot sign messages. Use a wallet that supports Solana message signing.",
      );
    const nonce = await api<{ id: string; message: string }>("challenge", {
      wallet: address,
    });
    const signature = await wallet.signMessage(
      new TextEncoder().encode(nonce.message),
    );
    await api("verify", { id: nonce.id, signature: bs58.encode(signature) });
    return address;
  }
  useEffect(() => {
    const id = sessionStorage.getItem(intentStorageKey);
    if (id)
      api<Intent>(`intent/${id}`)
        .then((value) => {
          if (!["expired", "failed"].includes(value.status)) setIntent(value);
          else sessionStorage.removeItem(intentStorageKey);
        })
        .catch(() => {});
  }, [address]);
  useEffect(() => {
    if (!intent || intent.status !== "submitted") return;
    const timer = setInterval(() => {
      api<Intent>(`intent/${intent.id}`)
        .then((next) => {
          setIntent((previous) =>
            previous?.id === next.id ? { ...previous, ...next } : previous,
          );
          if (
            ["confirmed", "failed", "expired"].includes(next.status) &&
            !(next.status === "confirmed" && next.kind === "launch-conversion")
          )
            sessionStorage.removeItem(intentStorageKey);
        })
        .catch(() =>
          setError(
            "Confirmation is taking longer. Keep this transaction reference; you can check it again in your wallet page.",
          ),
        );
    }, 2500);
    return () => clearInterval(timer);
  }, [intent?.id, intent?.status]);
  function review(next: Intent) {
    if (next.details.network !== network) {
      setNotice("The network changed. Refresh the page before continuing.");
      return;
    }
    setDirectTrade(false);
    setError("");
    setIntent(next);
    sessionStorage.setItem(intentStorageKey, next.id);
  }
  async function executeTrade(next: Intent) {
    if (next.kind !== "trade" || next.details.network !== network)
      throw new Error("Invalid trade transaction.");
    if (signing.current)
      throw new Error("A wallet approval is already pending.");
    setDirectTrade(true);
    setIntent(next);
    sessionStorage.setItem(intentStorageKey, next.id);
    await sign(next);
  }
  async function sign(current: Intent | null = intent) {
    if (!current || !wallet.signTransaction || signing.current) return;
    let intent = { ...current };
    signing.current = true;
    let submissionAttempted = false;
    tradeSounds.sounds.arm();
    setBusy(true);
    setError("");
    try {
      if (intent.details.network !== network)
        throw new Error("Transaction network does not match this app.");
      await authenticate();
      if (intent.kind?.startsWith("setup-token2022-")) {
        // Recheck after authentication, just before opening Phantom. Setup
        // requires a generated co-signer, so only the server can rebuild it.
        intent = await api<Intent>("setup", {
          symbol: intent.kind.slice("setup-token2022-".length),
        });
        setIntent(intent);
        sessionStorage.setItem(intentStorageKey, intent.id);
      }
      if (intent.status !== "prepared" || !intent.transaction) return;
      const adapter = wallet.wallet?.adapter;
      const decode = (bytes: Uint8Array) => {
        try {
          return Transaction.from(bytes);
        } catch {
          return VersionedTransaction.deserialize(bytes);
        }
      };
      let signedBytes: Uint8Array;
      if (
        adapter &&
        "standard" in adapter &&
        adapter.standard &&
        "wallet" in adapter
      ) {
        const standard = adapter.wallet as {
          accounts: readonly { address: string; chains: readonly string[] }[];
          features: {
            "solana:signTransaction"?: {
              signTransaction: (input: {
                account: unknown;
                chain: "solana:devnet" | "solana:mainnet";
                transaction: Uint8Array;
              }) => Promise<{ signedTransaction: Uint8Array }[]>;
            };
          };
        };
        const account = standard.accounts.find(
          (account) => account.address === address,
        );
        const signer = standard.features["solana:signTransaction"];
        if (!account?.chains.includes(chain) || !signer)
          throw new Error(
            `Enable Solana ${network} in this wallet to continue.`,
          );
        const [result] = await signer.signTransaction({
          account,
          chain,
          transaction: new Uint8Array(
            Buffer.from(intent.transaction, "base64"),
          ),
        });
        signedBytes = result.signedTransaction;
      } else {
        const signed = await wallet.signTransaction(
          decode(Buffer.from(intent.transaction, "base64")),
        );
        signedBytes = signed.serialize();
      }
      const reviewedMessage = VersionedTransaction.deserialize(
        Buffer.from(intent.transaction, "base64"),
      ).message.serialize();
      const returnedMessage =
        VersionedTransaction.deserialize(signedBytes).message.serialize();
      if (
        !["trade", "claim"].includes(intent.kind ?? "") &&
        !Buffer.from(reviewedMessage).equals(Buffer.from(returnedMessage))
      ) {
        const revised = await api<Intent>("review-wallet-fee", {
          id: intent.id,
          transaction: Buffer.from(signedBytes).toString("base64"),
        });
        setIntent(revised);
        setError(
          "Your wallet adjusted the network fee. Review the updated priority fee, then approve again. Nothing has been sent.",
        );
        return;
      }
      submissionAttempted = true;
      const result = await api<Intent>("submit", {
        id: intent.id,
        transaction: Buffer.from(signedBytes).toString("base64"),
      });
      setIntent({ ...intent, ...result });
    } catch (e) {
      if (intent.kind === "trade") {
        // A validation/auth rejection occurs before broadcast. Network failures
        // and server errors remain ambiguous and must keep signature recovery.
        const status = tradeSubmissionFailure(submissionAttempted, e);
        setIntent({
          ...intent,
          status,
        });
        if (status !== "submitted") sessionStorage.removeItem(intentStorageKey);
      }
      setError(
        e instanceof Error
          ? e.message
          : "The wallet declined this transaction.",
      );
    } finally {
      signing.current = false;
      setBusy(false);
    }
  }
  const links = [
    { href: "/app", label: "Explore", Icon: Compass },
    { href: "/app/create", label: "Launch a token", Icon: Rocket },
    { href: "/app/portfolio", label: "Your wallet", Icon: Wallet },
    { href: "/app/leaderboard", label: "Leaderboard", Icon: Trophy },
    { href: "/app/office", label: "Retard Office", Icon: Building2 },
    { href: "/app/docs", label: "Docs", Icon: BookOpen },
  ];
  return (
    <Context.Provider
      value={{
        theme,
        authenticate,
        transactionRevision,
        lastConfirmedTrade,
        review,
        executeTrade,
        tradePending:
          !!intent &&
          intent.kind === "trade" &&
          ["prepared", "submitted"].includes(intent.status),
        wallet: address,
        notice,
        setNotice,
        network,
        explorer: (kind, value) => explorerUrl(network, kind, value),
      }}
    >
      <div
        data-theme={theme}
        className={`launchpad${navCollapsed ? " lp-nav-collapsed" : ""}`}
      >
        <aside className="lp-sidebar" id="app-navigation">
          <button
            type="button"
            className="lp-panel-toggle lp-sidebar-toggle"
            aria-label={
              navCollapsed ? "Expand navigation" : "Collapse navigation"
            }
            title={navCollapsed ? "Expand navigation" : "Collapse navigation"}
            aria-expanded={!navCollapsed}
            aria-controls="app-navigation"
            onClick={toggleNavigation}
          >
            {navCollapsed ? (
              <PanelLeftOpen size={19} />
            ) : (
              <PanelLeftClose size={19} />
            )}
          </button>

          <Link href="/app" className="lp-brand" aria-label="One Only home">
            <img src="/brand/logo-128.webp" width="43" height="43" alt="" />
            <span>
              one
              <br />
              only
            </span>
          </Link>
          <div className="lp-network">
            <i /> SOLANA {network === "mainnet-beta" ? "MAINNET" : "DEVNET"}
          </div>
          <nav aria-label="App navigation">
            {links.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                aria-label={label}
                title={label}
                aria-current={
                  pathname === href ||
                  (href === "/app/docs" && pathname.startsWith("/app/docs/")) ||
                  (href === "/app" && pathname === "/")
                    ? "page"
                    : undefined
                }
              >
                <Icon size={19} />
                <span className="lp-nav-label">{label}</span>
              </Link>
            ))}
            <a
              href={supportUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Telegram support"
              title="Telegram support"
            >
              <MessageCircle size={19} />
              <span className="lp-nav-label">Support</span>
            </a>
          </nav>
        </aside>
        <div className="lp-workspace">
          {network === "devnet" && (
            <div className="lp-devnet-banner" role="note">
              <strong>Devnet preview</strong>
              <span>Test funds only. Tokens and balances have no real value.</span>
            </div>
          )}
          <header className="lp-topbar">
            <span className="lp-mobile-network">
              {network === "mainnet-beta" ? "MAINNET" : "DEVNET"}
            </span>
            <span className="lp-top-title">
              {pathname.includes("/docs")
                ? "THE FIELD GUIDE"
                : pathname.includes("create")
                  ? "THE LAUNCH BAY"
                  : pathname.includes("portfolio")
                    ? "YOUR CORNER"
                    : pathname.includes("leaderboard")
                      ? "THE LEADERBOARD"
                      : pathname.includes("office")
                        ? "RETARD OFFICE"
                        : pathname.includes("token/")
                          ? "THE MARKET"
                          : "THE WASTELAND"}
            </span>
            <div className="lp-topbar-actions">
              <button
                className="lp-theme-toggle"
                type="button"
                onClick={tradeSounds.toggle}
                aria-label={
                  tradeSounds.enabled
                    ? "Mute trade sounds"
                    : "Enable trade sounds"
                }
                title={
                  tradeSounds.enabled
                    ? "Mute trade sounds"
                    : "Enable trade sounds"
                }
                aria-pressed={tradeSounds.enabled}
              >
                {tradeSounds.enabled ? (
                  <Volume2 size={18} />
                ) : (
                  <VolumeX size={18} />
                )}
              </button>
              <button
                className="lp-theme-toggle"
                type="button"
                onClick={toggleTheme}
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
                title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              >
                {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
              </button>
              <XAccountButton />
              <WalletMultiButton />
            </div>
          </header>
          <main className="lp-main">
            {notice && (
              <div role="status" className="lp-notice">
                {notice}
                <button
                  aria-label="Dismiss message"
                  onClick={() => setNotice("")}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            {children}
          </main>
          <footer className="lp-bottom">
            <span>ONE ONLY</span>
            <div className="lp-footer-links">
              <Link href="/app/docs">Docs</Link>
              <a href={supportUrl} target="_blank" rel="noopener noreferrer">
                Telegram support <ExternalLink size={12} />
              </a>
            </div>
            <a
              href="https://docs.meteora.ag/developer-guides/dbc"
              target="_blank"
              rel="noreferrer"
            >
              Powered by Meteora <ExternalLink size={12} />
            </a>
          </footer>
        </div>
        {success && (
          <div className="lp-success-toast" role="status">
            <Check size={21} aria-hidden="true" />
            <div>
              <strong>
                {success.kind === "trade"
                  ? success.details.side === "sell"
                    ? "Sale confirmed"
                    : "Purchase confirmed"
                  : success.kind === "launch"
                    ? "Token launched"
                    : success.kind === "claim"
                      ? "Fees claimed"
                      : "Transaction confirmed"}
              </strong>
              {success.kind === "launch" &&
                success.details.firstBuy?.startsWith("None") && (
                  <p>Created without a first buy.</p>
                )}
              {success.signature && (
                <a
                  href={explorerUrl(network, "tx", success.signature)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction <ExternalLink size={12} />
                </a>
              )}
              {success.kind === "launch" && success.tokenId && (
                <Link href={`/app/token/${success.tokenId}`}>View token</Link>
              )}
            </div>
            <button
              aria-label="Dismiss success notification"
              onClick={() => setSuccess(null)}
            >
              <X size={17} />
            </button>
          </div>
        )}
        {purchase?.tokenId && (
          <PurchaseShare
            key={purchase.id}
            saleId={
              purchase.kind === "trade" && purchase.details.side === "sell"
                ? purchase.id
                : undefined
            }
            tokenId={purchase.tokenId}
            ticker={purchase.details.ticker}
            side={purchase.details.side === "sell" ? "sell" : "buy"}
            onClose={() => setPurchase(null)}
          />
        )}
        {intent && directTrade && (
          <div
            className="lp-success-toast lp-transaction-toast"
            role={error || intent.error ? "alert" : "status"}
          >
            {busy || intent.status === "submitted" ? (
              <LoaderCircle className="lp-spin" size={20} />
            ) : null}
            <div>
              <strong>
                {busy
                  ? "Approve in your wallet"
                  : intent.status === "submitted"
                    ? "Confirming trade…"
                    : "Trade update"}
              </strong>
              {(error || intent.error) && <p>{error || intent.error}</p>}
              {intent.signature && (
                <a
                  href={explorerUrl(network, "tx", intent.signature)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction
                </a>
              )}
              {!busy && intent.status === "prepared" && error && (
                <button className="lp-text-link" onClick={() => void sign()}>
                  Retry approval
                </button>
              )}
              {!busy &&
                ["failed", "expired", "approval-failed"].includes(
                  intent.status,
                ) && (
                  <button
                    className="lp-text-link"
                    onClick={() => setIntent(null)}
                  >
                    Dismiss
                  </button>
                )}
            </div>
          </div>
        )}
        {intent && !directTrade && (
          <div className="lp-modal-backdrop">
            <section
              ref={dialog}
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !busy) {
                  setIntent(null);
                  return;
                }
                if (event.key !== "Tab") return;
                const items = Array.from(
                  dialog.current?.querySelectorAll<HTMLElement>(
                    "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled)",
                  ) ?? [],
                );
                const first = items[0],
                  last = items.at(-1);
                if (
                  event.shiftKey &&
                  (document.activeElement === first ||
                    document.activeElement === dialog.current)
                ) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }}
              className="lp-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="review-title"
            >
              <button
                className="lp-close"
                aria-label="Close transaction review"
                onClick={() => setIntent(null)}
                disabled={busy}
              >
                <X />
              </button>
              <span className="lp-kicker">
                {network === "mainnet-beta" ? "MAINNET" : "DEVNET"} TRANSACTION
              </span>
              <h2 id="review-title">
                {intent.status === "confirmed"
                  ? "It’s on-chain."
                  : intent.status === "submitted"
                    ? "Sending it…"
                    : intent.status === "expired"
                      ? "This quote expired."
                      : "Check it. Then send it."}
              </h2>
              <dl>
                {Object.entries(intent.details).map(([key, value]) => (
                  <div key={key}>
                    <dt>
                      {(
                        {
                          minimumOutput: "Minimum received",
                          expectedOutput: "Estimated received",
                          priceReference: "USD reference time",
                          input: "Maximum input",
                          estimatedSpend: "Estimated spend",
                          network: "Network",
                          venue: "Trading venue",
                          pool: "Pool address",
                          networkCosts: "Network costs",
                          priorityFee: "Priority fee",
                          side: "Trade",
                          ticker: "Ticker",
                          slippage: "Slippage",
                          action: "Action",
                          nextStep: "Next step",
                          conversionBalance: "Remaining balance",
                        } as Record<string, string>
                      )[key] ?? key}
                    </dt>
                    <dd title={value}>{formatReviewValue(key, value)}</dd>
                  </div>
                ))}
              </dl>
              <p className="lp-muted">
                You approve this exact transaction in your wallet. Network fees
                and token-account rent are additional.
              </p>
              {error && (
                <p className="lp-error" role="alert">
                  {error}
                </p>
              )}
              {intent.error && <p className="lp-error">{intent.error}</p>}
              {intent.status === "expired" &&
                intent.kind?.startsWith("setup-token2022-") && (
                  <button
                    className="lp-primary"
                    disabled={busy}
                    onClick={() => void sign()}
                  >
                    {busy ? "Refreshing…" : "Refresh and approve"}
                  </button>
                )}
              {intent.status === "prepared" && (
                <button
                  className="lp-primary"
                  onClick={() => void sign()}
                  disabled={busy || !wallet.signTransaction}
                >
                  {busy ? (
                    <LoaderCircle className="lp-spin" size={18} />
                  ) : (
                    <Wallet size={18} />
                  )}{" "}
                  {busy ? "Check your wallet…" : "Approve in wallet"}
                </button>
              )}
              {intent.status === "submitted" && (
                <p className="lp-pending">
                  <LoaderCircle className="lp-spin" size={18} /> Waiting for
                  confirmation. You can safely close this and return from Your
                  wallet.
                </p>
              )}
              {intent.status === "confirmed" &&
                intent.kind === "launch-conversion" && (
                  <button
                    className="lp-primary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        await authenticate();
                        review(
                          await api<Intent>("continue-launch", {
                            id: intent.id,
                          }),
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? "Preparing launch…" : "Continue to launch · step 2"}
                  </button>
                )}
              {intent.status === "confirmed" && intent.tokenId && (
                <Link
                  className="lp-primary"
                  href={`/app/token/${intent.tokenId}`}
                  onClick={() => setIntent(null)}
                >
                  <Check size={18} /> View token
                </Link>
              )}
              {intent.signature && (
                <a
                  className="lp-text-link"
                  href={explorerUrl(network, "tx", intent.signature)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction <ExternalLink size={14} />
                </a>
              )}
            </section>
          </div>
        )}
      </div>
    </Context.Provider>
  );
}
export function LaunchpadProvider({
  children,
  network,
  initialTheme,
}: {
  children: ReactNode;
  network: SolanaNetwork;
  initialTheme: Theme;
}) {
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={publicRpc(network)}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <Shell network={network} initialTheme={initialTheme}>
            {children}
          </Shell>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
