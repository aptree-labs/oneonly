"use client";
import { useEffect, useState, type FormEvent } from "react";
import { MessageCircle, BadgeCheck, Trash2 } from "lucide-react";
import { api, short, useLaunchpad } from "./provider";
type Comment = {
  id: string;
  wallet: string;
  body: string;
  purchaseSignature: string;
  createdAt: string;
  profile?: { username: string; avatar: string | null } | null;
};
type Page = { comments: Comment[]; next: string | null };
export function TraderComments({ tokenId }: { tokenId: string }) {
  const app = useLaunchpad();
  const [comments, setComments] = useState<Comment[]>([]),
    [next, setNext] = useState<string | null>(null),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [profile, setProfile] = useState<Comment["profile"]>(null),
    [xAvailable, setXAvailable] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    api<Page>(`comments/${tokenId}`)
      .then((data) => {
        if (live) {
          setComments(data.comments);
          setNext(data.next);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [tokenId, revision]);
  useEffect(() => {
    setText(sessionStorage.getItem(`oneonly-comment-${tokenId}`) ?? "");
  }, [tokenId]);
  useEffect(() => {
    let live = true;
    setProfile(null);
    api<{
      wallet: string | null;
      profile: Comment["profile"];
      available: boolean;
    }>("profile")
      .then((data) => {
        if (live) {
          setXAvailable(data.available);
          setProfile(data.wallet === app.wallet ? data.profile : null);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [app.wallet]);
  async function linkX() {
    setBusy(true);
    setError("");
    try {
      await app.authenticate();
      const result = await api<{ url: string }>("link-x", { tokenId });
      sessionStorage.setItem(`oneonly-comment-${tokenId}`, text);
      window.location.assign(result.url);
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  async function post(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await app.authenticate();
      const { comment } = await api<{ comment: Comment }>("comment", {
        tokenId,
        body: text,
      });
      setComments((rows) => [comment, ...rows]);
      setText("");
      sessionStorage.removeItem(`oneonly-comment-${tokenId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id="comments"
      className="lp-panel lp-comments"
      aria-label="Trader comments"
    >
      <div className="lp-section-heading">
        <h2>
          <MessageCircle size={22} /> The trading floor
        </h2>
        <span>Verified buyers</span>
      </div>
      <form onSubmit={post} className="lp-comment-composer">
        <label>
          <span className="lp-sr-only">Your comment</span>
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              event.target.style.height = "auto";
              event.target.style.height = `${Math.min(event.target.scrollHeight, 240)}px`;
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                if (!busy && text.trim())
                  event.currentTarget.form?.requestSubmit();
              }
            }}
            required
            disabled={busy}
            maxLength={500}
            rows={3}
            placeholder="What’s your take?"
          />
        </label>
        <div className="lp-composer-footer">
          <div className="lp-composer-identity">
            {profile ? (
              <a
                href={`https://x.com/${encodeURIComponent(profile.username)}`}
                target="_blank"
                rel="noreferrer"
                className="lp-comment-author"
              >
                {profile.avatar && (
                  <img
                    src={profile.avatar}
                    width={28}
                    height={28}
                    alt=""
                    referrerPolicy="no-referrer"
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                    }}
                  />
                )}
                @{profile.username}
              </a>
            ) : (
              <span className="lp-caption">
                {app.wallet ? short(app.wallet) : "Buyers can post"}
              </span>
            )}
            {xAvailable && (
              <button
                type="button"
                className="lp-text-link"
                disabled={busy}
                onClick={() => void linkX()}
              >
                {profile ? "Update X" : "Link X"}
              </button>
            )}
          </div>
          <span className="lp-caption">{text.length}/500</span>
          <button className="lp-primary" disabled={busy || !text.trim()}>
            {busy
              ? "Posting…"
              : app.wallet
                ? "Post comment"
                : "Connect to post"}
          </button>
        </div>
      </form>
      {error && (
        <p className="lp-error" role="alert">
          {error}{" "}
          <button
            type="button"
            className="lp-text-link"
            onClick={() => setRevision((value) => value + 1)}
          >
            Refresh comments
          </button>
        </p>
      )}
      {loading ? (
        <p className="lp-muted">Loading the conversation…</p>
      ) : (
        !comments.length && (
          <p className="lp-muted lp-comments-empty">
            No takes yet. Bought in? Start the conversation.
          </p>
        )
      )}
      <div className="lp-comment-list">
        {comments.map((comment) => (
          <article key={comment.id}>
            <header>
              {comment.profile ? (
                <a
                  className="lp-comment-author"
                  href={`https://x.com/${encodeURIComponent(comment.profile.username)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {comment.profile.avatar && (
                    <img
                      src={comment.profile.avatar}
                      width={32}
                      height={32}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={(event) => {
                        event.currentTarget.hidden = true;
                      }}
                    />
                  )}
                  <strong>@{comment.profile.username}</strong>
                </a>
              ) : (
                <strong>{short(comment.wallet)}</strong>
              )}
              <a
                href={app.explorer("tx", comment.purchaseSignature)}
                target="_blank"
                rel="noreferrer"
                className="lp-buyer-badge"
              >
                <BadgeCheck size={14} /> Buyer
              </a>
              <time dateTime={comment.createdAt}>
                {new Date(comment.createdAt).toLocaleString()}
              </time>
              {comment.wallet === app.wallet && (
                <button
                  className="lp-icon-button"
                  aria-label="Delete your comment"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await app.authenticate();
                      await api("comment-delete", { id: comment.id });
                      setComments((rows) =>
                        rows.filter((row) => row.id !== comment.id),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </header>
            <p>{comment.body}</p>
          </article>
        ))}
      </div>
      {next && (
        <button
          className="lp-secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const page = await api<Page>(
                `comments/${tokenId}?before=${encodeURIComponent(next)}`,
              );
              setComments((rows) => [
                ...rows,
                ...page.comments.filter(
                  (item) => !rows.some((row) => row.id === item.id),
                ),
              ]);
              setNext(page.next);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Older comments
        </button>
      )}
    </section>
  );
}
