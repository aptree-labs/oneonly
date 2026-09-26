"use client";
import { useEffect, useState } from "react";
import { useLaunchpad } from "../launchpad/provider";
export type FeeProfile = {
  xId: string;
  username: string;
  name?: string;
  avatar?: string | null;
};
export type FeeRecipient = FeeProfile & { shareBps: number };
export type FeeStatus = {
  enabled: boolean;
  network: string;
  lookupAvailable: boolean;
  bindingAvailable: boolean;
  escrowAvailable: boolean;
};
export async function feeApi<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/creator-fees/${path}`, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    signal,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const result = await response.json().catch(() => {
    throw new Error("Creator fees are temporarily unavailable. Try again.");
  });
  if (!response.ok)
    throw new Error(result.error || "Couldn’t complete that request.");
  return result as T;
}
export function useFeeStatus() {
  const { network } = useLaunchpad();
  const [status, setStatus] = useState<FeeStatus | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (network !== "devnet") return;
    const controller = new AbortController();
    feeApi<FeeStatus>("status", undefined, controller.signal)
      .then(setStatus)
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [network]);
  return {
    status: network === "devnet" ? status : null,
    error,
    devnet: network === "devnet",
  };
}
