"use client";

import { useEffect, useSyncExternalStore } from "react";
import { distanceMi, type LatLon } from "./geo";

// Airports with scheduled passenger service (from OurAirports, built by scripts/build-airports.mjs).
// The area around each one is a no-catch zone: planes there are taking off or landing, low and slow,
// and would be too easy to farm. Shown grey on the map and the radar.

export type Airport = LatLon & {
  code: string;
  name: string;
  size: "L" | "M";
  /** Radius of its no-catch zone. */
  zoneMi: number;
};

/** Large airports get a bigger zone than medium ones. */
export const ZONE_MI = { L: 3, M: 2 } as const;

type Row = [code: string, name: string, lat: number, lon: number, size: "L" | "M"];

let airports: Airport[] | null = null;
let loading = false;
const listeners = new Set<() => void>();

async function load() {
  if (airports || loading) return;
  loading = true;
  try {
    const res = await fetch("/airports.json");
    if (!res.ok) throw new Error(`airports.json: HTTP ${res.status}`);
    const rows = (await res.json()) as Row[];
    airports = rows.map(([code, name, lat, lon, size]) => ({ code, name, lat, lon, size, zoneMi: ZONE_MI[size] }));
  } catch {
    airports = null; // try again next time a page asks; meanwhile no zones show
  } finally {
    loading = false;
    listeners.forEach((l) => l());
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** All airports, or null while loading (or if they couldn't load). Loaded once, then shared. */
export function useAirports(): Airport[] | null {
  const list = useSyncExternalStore(subscribe, () => airports, () => null);
  useEffect(() => {
    void load();
  }, []);
  return list;
}

/** Airports whose zone reaches within `withinMi` of a point. */
export function airportsNear(list: Airport[] | null, p: LatLon, withinMi: number): Airport[] {
  if (!list) return [];
  return list.filter((a) => distanceMi(a, p) <= withinMi + a.zoneMi);
}

/** The airport whose no-catch zone contains this point, if any. */
export function noCatchZoneAt(list: Airport[] | null, p: LatLon): Airport | null {
  if (!list) return null;
  return list.find((a) => distanceMi(a, p) <= a.zoneMi) ?? null;
}

/** "Chicago O'Hare International Airport" → "Chicago O'Hare International". */
export function shortName(a: Airport): string {
  return a.name.replace(/\s+Airport$/i, "");
}
