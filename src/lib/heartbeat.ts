"use client";

import { useEffect } from "react";
import { touchHunter } from "./store";

/** How often an open radar page says "I'm still here". The worker counts anyone seen in the last minute. */
export const HEARTBEAT_MS = 25_000;

/**
 * While the radar is open and visible, mark this person active, so the worker keeps fetching planes
 * near them. Stops when the tab is hidden or they leave the page; the worker stops a minute later.
 */
export function useHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const beat = () => void touchHunter();
    const start = () => {
      if (timer || document.hidden) return;
      beat();
      timer = setInterval(beat, HEARTBEAT_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}
