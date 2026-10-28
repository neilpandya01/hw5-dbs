"use client";

import { useSyncExternalStore } from "react";
import { roundPosition, type LatLon } from "./geo";
import type { Rarity } from "./rarity";

// The only data layer for a person's own data: onboarding, their saved location, and their catches.
//
// FOR NOW this saves to this device (localStorage, one entry per Clerk user), because Supabase isn't
// connected yet. Pages only use the functions below, never storage directly, so moving to Supabase
// only changes this file. The shapes match the planned tables (see docs/data-flow.md).

export type Catch = {
  id: string;
  /** The aircraft's ICAO hex code, e.g. "a62d6e". */
  hex: string;
  /** As broadcast, trimmed: "UAL868", or a tail number like "N66DV" for private planes. */
  callsign: string;
  /** ICAO airline code from the callsign ("UAL"), or null for private and unknown planes. */
  airlineCode: string | null;
  airlineName: string | null;
  /** ICAO type code ("B788") and its name ("Boeing 787-8"). */
  typeCode: string | null;
  typeName: string | null;
  rarity: Rarity;
  caughtAt: string;
};

export type SavedLocation = LatLon & { savedAt: string };

export type Data = {
  /** Set when the welcome flow is finished. */
  onboarded: boolean;
  /** Rounded to about 1 km. Used to know where to look for planes. */
  location: SavedLocation | null;
  catches: Catch[];
};

/** save-failed: a change wasn't saved. load-failed: saved data couldn't be read. */
export type StorageStatus = "ok" | "save-failed" | "load-failed";

export type Snapshot = { userId: string; data: Data; storage: StorageStatus };

const EMPTY: Data = { onboarded: false, location: null, catches: [] };
const keyFor = (userId: string) => `skyhunt:user:${userId}`;

let snapshot: Snapshot | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The signed-in person's data, or null until it has loaded (and when signed out). */
export function useStore(): Snapshot | null {
  return useSyncExternalStore(subscribe, () => snapshot, () => null);
}

function parse(raw: string | null): Data {
  if (!raw) return EMPTY;
  const v = JSON.parse(raw) as Partial<Data>;
  const loc = v.location;
  return {
    onboarded: v.onboarded === true,
    location:
      loc && typeof loc.lat === "number" && typeof loc.lon === "number"
        ? { lat: loc.lat, lon: loc.lon, savedAt: String(loc.savedAt ?? "") }
        : null,
    catches: Array.isArray(v.catches) ? v.catches : [],
  };
}

/** Called by AccountSync on sign-in (with the Clerk user ID) and on sign-out (null). */
export function loadStore(userId: string | null) {
  if (!userId) {
    snapshot = null;
    return emit();
  }
  try {
    snapshot = { userId, data: parse(localStorage.getItem(keyFor(userId))), storage: "ok" };
  } catch {
    snapshot = { userId, data: EMPTY, storage: "load-failed" };
  }
  emit();
}

function update(change: (d: Data) => Data) {
  if (!snapshot) return;
  const data = change(snapshot.data);
  let storage: StorageStatus = snapshot.storage === "load-failed" ? "load-failed" : "ok";
  try {
    localStorage.setItem(keyFor(snapshot.userId), JSON.stringify(data));
  } catch {
    storage = "save-failed";
  }
  snapshot = { ...snapshot, data, storage };
  emit();
}

/** Saves where someone is, rounded to about 1 km. The exact position is never saved. */
export function saveLocation(p: LatLon) {
  update((d) => ({ ...d, location: { ...roundPosition(p), savedAt: new Date().toISOString() } }));
}

export function finishOnboarding() {
  update((d) => ({ ...d, onboarded: true }));
}

export function isNewUser(s: Snapshot): boolean {
  return !s.data.onboarded;
}
