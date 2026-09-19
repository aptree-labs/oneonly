"use client";
import { useEffect, useRef, useState } from "react";
import { TradeSounds } from "@/lib/trade-sounds";
const preferenceKey = "oneonly-trade-sounds";
export function useTradeSounds() {
  const [enabled, setEnabled] = useState(true);
  const sounds = useRef<TradeSounds | null>(null);
  if (!sounds.current) sounds.current = new TradeSounds();
  useEffect(() => {
    try {
      const next = localStorage.getItem(preferenceKey) !== "off";
      sounds.current!.setEnabled(next);
      setEnabled(next);
    } catch {}
    return () => sounds.current?.dispose();
  }, []);
  function toggle() {
    const next = !sounds.current!.enabled;
    sounds.current!.setEnabled(next);
    setEnabled(next);
    try {
      localStorage.setItem(preferenceKey, next ? "on" : "off");
    } catch {}
  }
  return { enabled, toggle, sounds: sounds.current };
}
