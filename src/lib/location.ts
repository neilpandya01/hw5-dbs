"use client";

import { useEffect, useRef, useState } from "react";
import { distanceMi, type LatLon } from "./geo";
import { saveLocation, useStore } from "./store";

// Where the person is. Sky Hunt needs a location to work (it shows planes near you).
//
// The exact position stays in this browser's memory. Only a rounded copy (about 1 km) is saved,
// and only when it changes enough to matter: after moving 2+ km, at most once a minute.
// That keeps writes rare, and never stores a trail of where someone has been.

export type LocateProblem = "denied" | "unavailable" | "timeout" | "unsupported";

export type LocateResult = { ok: true; position: LatLon } | { ok: false, problem: LocateProblem };

/** Give up looking after this long and say so, rather than spinning forever. */
export const LOCATE_TIMEOUT_MS = 15_000;
const SAVE_AFTER_MOVING_MI = 1.25; // about 2 km
const MIN_SAVE_GAP_MS = 60_000;

function problemOf(err: GeolocationPositionError): LocateProblem {
  if (err.code === err.PERMISSION_DENIED) return "denied";
  if (err.code === err.TIMEOUT) return "timeout";
  return "unavailable";
}

/** Asks the browser once (it shows its permission prompt the first time). */
export function locateOnce(): Promise<LocateResult> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return Promise.resolve({ ok: false, problem: "unsupported" });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ ok: true, position: { lat: p.coords.latitude, lon: p.coords.longitude } }),
      (err) => resolve({ ok: false, problem: problemOf(err) }),
      { enableHighAccuracy: false, timeout: LOCATE_TIMEOUT_MS, maximumAge: 60_000 },
    );
  });
}

export type LiveLocation =
  | { status: "locating" }
  | { status: "live"; position: LatLon }
  | { status: "problem"; problem: LocateProblem };

/**
 * Follows the person's position while the page is open (and stops when it's hidden or left).
 * `attempt` restarts it, for a "Try again" button.
 */
export function useLiveLocation(attempt = 0): LiveLocation {
  const store = useStore();
  const saved = store?.data.location ?? null;
  const [state, setState] = useState<LiveLocation>({ status: "locating" });
  const lastSave = useRef(0);
  const savedRef = useRef(saved);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      queueMicrotask(() => setState({ status: "problem", problem: "unsupported" }));
      return;
    }
    queueMicrotask(() => setState((s) => (s.status === "live" ? s : { status: "locating" })));
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const position = { lat: p.coords.latitude, lon: p.coords.longitude };
        setState({ status: "live", position });
        const prev = savedRef.current;
        const now = Date.now();
        const movedFar = !prev || distanceMi(prev, position) >= SAVE_AFTER_MOVING_MI;
        if (movedFar && now - lastSave.current >= MIN_SAVE_GAP_MS) {
          lastSave.current = now;
          saveLocation(position);
        }
      },
      (err) => setState({ status: "problem", problem: problemOf(err) }),
      { enableHighAccuracy: false, timeout: LOCATE_TIMEOUT_MS, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [attempt]);

  return state;
}

/** What went wrong, and what to do about it, in plain words. */
export function problemMessage(problem: LocateProblem): { title: string; help: string } {
  switch (problem) {
    case "denied":
      return {
        title: "Location is blocked for Sky Hunt.",
        help: "Click the icon at the left of the address bar, set Location to Allow, then press Try again.",
      };
    case "timeout":
      return {
        title: "Couldn't find you in time.",
        help: "Check that location services are on for this device, then press Try again.",
      };
    case "unsupported":
      return {
        title: "This browser can't share a location.",
        help: "Open Sky Hunt in an up-to-date browser such as Chrome, Safari, Firefox, or Edge.",
      };
    default:
      return {
        title: "Your location isn't available right now.",
        help: "Check that location services are on for this device, then press Try again.",
      };
  }
}
