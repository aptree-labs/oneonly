"use client";
import { useEffect, useState } from "react";
export function usePanelState(key: string) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(key) === "collapsed");
    } catch {
      /* Storage may be unavailable in private sessions. */
    }
  }, [key]);
  const toggle = () =>
    setCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(key, next ? "collapsed" : "expanded");
      } catch {
        /* The panel still works without persistence. */
      }
      return next;
    });
  return [collapsed, toggle] as const;
}
