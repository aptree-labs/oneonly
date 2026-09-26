"use client";
import { useEffect, useState } from "react";
import { LoaderCircle, Plus, Trash2, Users } from "lucide-react";
import {
  feeApi,
  useFeeStatus,
  type FeeProfile,
  type FeeRecipient,
} from "./client";
import { FeeIdentity } from "./profile";
import { useLaunchpad } from "../launchpad/provider";
import "./creator-fees.css";
export function AllocationEditor({
  value,
  onChange,
  onValidity,
}: {
  value: FeeRecipient[];
  onChange: (recipients: FeeRecipient[]) => void;
  onValidity: (valid: boolean) => void;
}) {
  const { status, devnet, error: statusError } = useFeeStatus();
  const app = useLaunchpad();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [profiles, setProfiles] = useState<FeeProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const total = value.reduce((sum, row) => sum + row.shareBps, 0);
  const valid =
    !open ||
    (status?.escrowAvailable === true &&
      value.length > 0 &&
      total === 10000 &&
      value.every((row) => row.shareBps > 0));
  useEffect(() => {
    onValidity(valid);
  }, [valid, onValidity]);
  useEffect(() => {
    if (!open || !status?.lookupAvailable || !search.trim()) {
      setProfiles([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setProfiles([]);
    const timer = setTimeout(() => {
      feeApi<{ profiles: FeeProfile[] }>(
        `profiles?q=${encodeURIComponent(search.trim())}`,
        undefined,
        controller.signal,
      )
        .then((result) => {
          if (!controller.signal.aborted) setProfiles(result.profiles);
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(error.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, open, status?.lookupAvailable]);
  function add(profile: FeeProfile) {
    if (value.length >= 8 || value.some((row) => row.xId === profile.xId))
      return;
    onChange([...value, { ...profile, shareBps: Math.max(0, 10000 - total) }]);
    setSearch("");
    setProfiles([]);
    setError("");
  }
  async function addMe() {
    setLoading(true);
    setError("");
    try {
      await app.authenticate();
      const result = await feeApi<{
        profile: FeeProfile | null;
        connectedProfile?: FeeProfile | null;
      }>("me");
      const connectedProfile =
        "connectedProfile" in result ? result.connectedProfile : result.profile;
      if (!connectedProfile)
        throw new Error("Connect X in the top bar to add your account.");
      add(connectedProfile);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }
  if (!devnet) return null;
  return (
    <section className="cf-editor">
      <button
        type="button"
        className="cf-editor-toggle"
        aria-expanded={open}
        aria-controls="creator-fee-editor"
        onClick={() => {
          setOpen(!open);
          if (open) onChange([]);
        }}
      >
        <span>
          <Users size={20} />
          <strong>Share creator fees</strong>
        </span>
        <span>{open ? "Remove" : "Optional +"}</span>
      </button>
      {open && (
        <div id="creator-fee-editor" className="cf-editor-body">
          <p className="lp-caption">
            Allocate your creator share to X accounts. Recipients can join
            later.
          </p>
          {!status?.escrowAvailable && (
            <p className="lp-notice">
              {statusError ||
                "Fee sharing is being prepared for devnet. You can explore recipients, but shared-fee launches are not available yet."}
            </p>
          )}
          {status && !status.lookupAvailable && (
            <p className="lp-notice">X account search is not available yet.</p>
          )}
          {status && !status.bindingAvailable && (
            <p className="lp-notice">X account linking is not available yet.</p>
          )}
          <div className="cf-split" aria-label={`${total / 100}% allocated`}>
            {value.map((row, index) => (
              <span
                key={row.xId}
                className={`cf-color-${index % 4}`}
                style={{ flexGrow: row.shareBps }}
                title={`@${row.username}: ${row.shareBps / 100}%`}
              />
            ))}
            <span
              className="cf-unallocated"
              style={{ flexGrow: Math.max(0, 10000 - total) }}
            />
          </div>
          {value.map((row) => (
            <div className="cf-allocation" key={row.xId}>
              <FeeIdentity profile={row} />
              <label className="cf-share">
                <span className="sr-only">Share for @{row.username}</span>
                <input
                  inputMode="decimal"
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  value={row.shareBps / 100 || ""}
                  onChange={(event) =>
                    onChange(
                      value.map((item) =>
                        item.xId === row.xId
                          ? {
                              ...item,
                              shareBps: Math.round(
                                Number(event.target.value) * 100,
                              ),
                            }
                          : item,
                      ),
                    )
                  }
                />
                <span>%</span>
              </label>
              <button
                type="button"
                className="lp-secondary cf-icon-button"
                aria-label={`Remove @${row.username}`}
                onClick={() =>
                  onChange(value.filter((item) => item.xId !== row.xId))
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <div className="cf-allocation-total">
            <span>Creator share allocated</span>
            <strong className={total === 10000 ? "lp-valid" : ""}>
              {total / 100}% / 100%
            </strong>
          </div>
          <label>
            Find an X account
            <input
              value={search}
              disabled={!status?.lookupAvailable}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="@username"
              maxLength={100}
              autoComplete="off"
            />
          </label>
          <div className="cf-lookup-results" aria-live="polite">
            {loading && (
              <span className="cf-muted">
                <LoaderCircle size={16} className="lp-spin" /> Finding account…
              </span>
            )}
            {!loading &&
              search.trim() &&
              !profiles.length &&
              !error &&
              status?.lookupAvailable && (
                <p className="lp-caption">No matching account.</p>
              )}
            {profiles.map((profile) => (
              <button
                type="button"
                key={profile.xId}
                disabled={
                  value.length >= 8 ||
                  value.some((row) => row.xId === profile.xId)
                }
                onClick={() => add(profile)}
              >
                <FeeIdentity profile={profile} />
                <Plus size={18} />
              </button>
            ))}
          </div>
          <button
            type="button"
            className="lp-secondary"
            onClick={() => void addMe()}
            disabled={!status?.bindingAvailable || loading || value.length >= 8}
          >
            Add my connected X account
          </button>
          {error && (
            <p className="lp-error" role="alert">
              {error}
            </p>
          )}
          {value.length > 0 && (
            <p className="lp-caption">
              Shares are fixed at launch. Each recipient posts on X before
              claiming.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
