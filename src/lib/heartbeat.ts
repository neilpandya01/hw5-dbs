"use client";

import { useEffect, useState } from "react";
import { touchHunter } from "./store";

/** How often an open radar page says "I'm still here". The worker counts anyone seen in the last minute. */
export const HEARTBEAT_MS = 25_000;

/**
 * While the radar is open and visible, mark this person active, so the worker keeps fetching planes
 * near them. Stops when the tab is hidden or they leave the page; the worker stops a minute later.
 *
 * Returns the seconds of fast Radar time left today (null until the first answer). The database counts
 * it: 2 hours a day (UTC). Past that you keep playing; the worker just updates your zone every 30 s
 * instead of every 2 s, unless someone else there is still under 2 hours (docs/usage-limits.md).
 */
export function useHeartbeat(enabled: boolean): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    const beat = () =>
      void touchHunter().then((s) => {
        if (!cancelled && s !== null) setLeft(s);
      });
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
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
  return enabled ? left : null;
}
