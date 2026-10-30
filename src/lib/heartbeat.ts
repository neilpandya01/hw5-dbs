"use client";

import { useEffect, useState } from "react";
import { touchHunter } from "./store";

/** How often an open radar page says "I'm still here". The worker counts anyone seen in the last minute. */
export const HEARTBEAT_MS = 25_000;

/** Each person's Radar time per day (UTC), the same as touch_hunter() in the database. */
export const PLAY_LIMIT_S = 2 * 60 * 60;

/**
 * While the radar is open and visible, mark this person active, so the worker keeps fetching planes
 * near them. Stops when the tab is hidden or they leave the page; the worker stops a minute later.
 *
 * Returns the seconds of Radar time left today (null until the first answer). The database counts it:
 * 2 hours a day, so everyone gets a turn within the free plan (docs/usage-limits.md). At 0, it stops
 * marking you active; the check-ins continue (cheaply), so the Radar comes back on its own after
 * midnight UTC.
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
