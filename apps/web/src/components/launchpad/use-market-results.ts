"use client";
import { useEffect, useState, useRef } from "react";
import { useLaunchpad } from "./provider";
import {
  loadMarket,
  marketKey,
  peekMarket,
  seedMarket,
  type MarketResults,
} from "@/lib/market-results";
export function useMarketResults(
  params: URLSearchParams,
  initial?: MarketResults,
) {
  const key = marketKey(params);
  const initialKey = useRef(key);
  const seeded = useRef(false);
  const { transactionRevision } = useLaunchpad();
  const [state, setState] = useState({
    key,
    data: initial ?? peekMarket(key),
    error: "",
    refreshing: false,
  });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true,
      loading = false;
    if (
      initial &&
      !seeded.current &&
      key === initialKey.current &&
      !peekMarket(key) &&
      transactionRevision === 0 &&
      revision === 0
    )
      seedMarket(key, initial);
    seeded.current = true;
    const cached = peekMarket(key);
    setState({ key, data: cached, error: "", refreshing: true });
    async function load(force = false) {
      if (loading || document.hidden) return;
      loading = true;
      if (current) setState((previous) => ({ ...previous, refreshing: true }));
      try {
        const data = await loadMarket(key, force);
        if (current) setState({ key, data, error: "", refreshing: false });
      } catch (error) {
        if (current)
          setState((previous) => ({
            ...previous,
            key,
            error: (error as Error).message,
            refreshing: false,
          }));
      } finally {
        loading = false;
      }
    }
    const timer = setTimeout(
      () => void load(revision > 0 || transactionRevision > 0),
      cached || !params.get("search") ? 0 : 120,
    );
    const interval = setInterval(() => void load(true), 10_000);
    const focus = () => void load(true);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      current = false;
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [key, revision, transactionRevision]);
  const matching = state.key === key;
  return {
    data: matching ? state.data : undefined,
    error: matching ? state.error : "",
    busy: !matching || (!state.data && !state.error),
    refreshing: state.refreshing,
    reload: () => setRevision((v) => v + 1),
  };
}
