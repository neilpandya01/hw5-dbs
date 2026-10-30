import type { Connection, Run, Sighting } from "./flights";
import { CATCH_RANGE_MI, compass, distanceMi, type LatLon } from "./geo";

// What to show near you, whether each plane can be caught, and how fresh the flight data is.

/** How far out planes are shown. */
export const VIEW_MI = 15;
/** At most this many planes inside your 5-mile circle, and this many outside it. Closest first. */
export const MAX_IN_RANGE = 12;
export const MAX_OUTSIDE = 15;
/** Positions older than this are hidden (the worker stopped, or the plane landed). */
export const MAX_AGE_MS = 120_000;
/** A catch needs a ping this recent (matches catch_plane() in the database). */
export const CATCH_FRESH_MS = 90_000;

export type NearbyPlane = Sighting & {
  distanceMi: number;
  inRange: boolean;
  /** "northeast": which way it's flying. */
  direction: string | null;
};

export function nearbyPlanes(planes: Sighting[], me: LatLon, now: number): { inRange: NearbyPlane[]; outside: NearbyPlane[] } {
  const near = planes
    .filter((p) => now - p.seenAt <= MAX_AGE_MS)
    .map((p) => {
      const d = distanceMi(me, p);
      return { ...p, distanceMi: d, inRange: d <= CATCH_RANGE_MI, direction: p.heading === null ? null : compass(p.heading) };
    })
    .filter((p) => p.distanceMi <= VIEW_MI)
    .sort((a, b) => a.distanceMi - b.distanceMi);
  return {
    inRange: near.filter((p) => p.inRange).slice(0, MAX_IN_RANGE),
    outside: near.filter((p) => !p.inRange).slice(0, MAX_OUTSIDE),
  };
}

/** Why this plane can't be caught right now, or null if it can. */
export function catchBlock(p: NearbyPlane, now: number, caughtToday: Set<string>): string | null {
  if (p.kind !== "commercial") return "Only commercial flights can be caught.";
  if (caughtToday.has(p.hex)) return "You caught this plane today. Catch it again tomorrow.";
  if (now - p.seenAt > CATCH_FRESH_MS) return "Its last ping is too old. Wait for the next update.";
  if (p.airport) return `It was over the ${p.airport} airport zone at its last ping. Planes near airports can't be caught.`;
  if (!p.inRange) return `Its last ping was outside your ${CATCH_RANGE_MI}-mile circle.`;
  return null;
}

/** The same reasons as catchBlock(), in a word or two, for a list row. Null if it can be caught. */
export function catchShort(p: NearbyPlane, now: number, caughtToday: Set<string>): string | null {
  if (p.kind !== "commercial") return p.kind === "private" ? "Private" : "Unknown";
  if (caughtToday.has(p.hex)) return "Caught today";
  if (now - p.seenAt > CATCH_FRESH_MS) return "Waiting for update";
  if (p.airport) return `Over ${p.airport}`;
  if (!p.inRange) return "Outside circle";
  return null;
}

/** "Commercial" planes show their airline; others are "Private plane" or "Unknown aircraft". */
export function planeTitle(p: Pick<Sighting, "kind" | "airlineName">): string {
  if (p.kind === "commercial" && p.airlineName) return p.airlineName;
  return p.kind === "private" ? "Private plane" : "Unknown aircraft";
}

export function planeType(p: Pick<Sighting, "typeName" | "typeCode">): string {
  return p.typeName ?? (p.typeCode ? `Type ${p.typeCode}` : "Type unknown");
}

/** "just now", "12 s ago", "3 min ago". */
export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 3) return "just now";
  if (s < 60) return `${s} s ago`;
  return `${Math.floor(s / 60)} min ago`;
}

/**
 * How fresh the flight data is, from the worker's latest run (app-wide) and this page's live connection.
 * Checked in this order, so exactly one applies:
 *   loading     nothing loaded yet
 *   down        the database can't be reached; the live connection has been lost for over 45 s;
 *               the worker hasn't run in 5 minutes; or its latest run failed
 *   limit       updates are paused for everyone: today's free-plan share is used up, or every flight
 *               source is refusing us (until resumeAt, when known)
 *   connecting  the live connection is (re)starting (under 45 s): what's shown may be a little behind
 *   starting    the worker's latest run had nobody active (you just arrived): looking for planes
 *   stale       no run for 3 intervals plus 15 s (105 s normally, 195 s in slow mode)
 *   fresh       otherwise. `pace` says how often this zone updates: fast (every few seconds), normal
 *               (every 30 s: today's fast allowance is used, or the fallback source is in use), slow (60 s).
 *               "Updated" is this zone's latest update, or the latest run if that's newer.
 */
export type Feed =
  | { status: "loading" }
  | { status: "down" }
  | { status: "limit"; resumeAt: number | null }
  | { status: "connecting" }
  | { status: "starting" }
  | { status: "stale"; updatedAt: number }
  | { status: "fresh"; updatedAt: number; pace: "fast" | "normal" | "slow" };

/** How long the live connection may be lost before the page says flight data is unavailable. */
export const OFFLINE_DOWN_MS = 45_000;
/** No worker run for this long means the worker isn't running. */
export const WORKER_DOWN_MS = 5 * 60_000;

export function feedState(
  flights: {
    loaded: boolean;
    error: boolean;
    connection: Connection;
    offlineSince: number | null;
    run: Run | null;
    frameAt?: number | null;
  },
  now: number,
): Feed {
  const { loaded, error, connection, offlineSince, run } = flights;
  if (!loaded || now === 0) return { status: "loading" };
  if (error) return { status: "down" };
  const offlineFor = connection === "live" || offlineSince === null ? 0 : now - offlineSince;
  if (offlineFor > OFFLINE_DOWN_MS) return { status: "down" };
  if (!run || now - run.finishedAt > WORKER_DOWN_MS) return { status: "down" };
  if (run.mode === "paused") return { status: "limit", resumeAt: run.resumeAt };
  if (!run.ok) return { status: "down" };
  if (connection !== "live") return { status: "connecting" };
  if (run.mode === "idle") return { status: "starting" };
  const interval = run.mode === "slow" ? 60_000 : 30_000;
  if (now - run.finishedAt > 3 * interval + 15_000) return { status: "stale", updatedAt: run.finishedAt };
  const updatedAt = Math.max(run.finishedAt, flights.frameAt ?? 0);
  const pace = run.mode === "fast" ? "fast" : run.mode === "slow" ? "slow" : "normal";
  return { status: "fresh", updatedAt, pace };
}
