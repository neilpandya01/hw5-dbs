"use client";

import { useEffect, useSyncExternalStore } from "react";
import { roundCoord } from "./geo";

// The nearest city or town to a position, for "Near Chicago, Illinois" above the radar.
// Asks BigDataCloud's free browser endpoint (no key; meant for a device's own location).
//
// Only coordinates rounded to 2 decimals (about 1 km) are sent, the same precision we save.
// Not stored in the database: kept in memory, plus the last answer on this device so the name
// doesn't flicker on every app open. A failed lookup just shows "Your location".

const REVERSE_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";
const STORAGE_KEY = "skyhunt:nearestPlace";

/** key "lat,lon" → place name, or null when there isn't one (open sea) or the lookup failed. */
const cache = new Map<string, string | null>();
const pending = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function keyOf(lat: number, lon: number) {
  return `${roundCoord(lat)},${roundCoord(lon)}`;
}

function remember(key: string, name: string | null) {
  cache.set(key, name);
  if (name) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ key, name }));
    } catch {
      // Storage blocked (private window): memory is enough.
    }
  }
  listeners.forEach((l) => l());
}

function fromStorage(key: string): string | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { key: string; name: string } | null;
    return saved?.key === key ? saved.name : undefined;
  } catch {
    return undefined;
  }
}

/** "Chicago, Illinois"; "New York City, New York"; null in the middle of the ocean. */
function placeName(r: { city?: string; locality?: string; principalSubdivision?: string; countryName?: string }) {
  const town = r.city || r.locality;
  if (!town || (!r.principalSubdivision && !r.countryName)) return null;
  const region = r.principalSubdivision && r.principalSubdivision !== town ? r.principalSubdivision : r.countryName;
  return region && region !== town ? `${town}, ${region}` : town;
}

async function lookUp(key: string) {
  if (cache.has(key) || pending.has(key)) return;
  const stored = fromStorage(key);
  if (stored) return remember(key, stored);
  pending.add(key);
  const [latitude, longitude] = key.split(",");
  try {
    const params = new URLSearchParams({ latitude, longitude, localityLanguage: "en" });
    const res = await fetch(`${REVERSE_URL}?${params}`);
    if (!res.ok) throw new Error(`Reverse geocoding: HTTP ${res.status}`);
    remember(key, placeName(await res.json()));
  } catch {
    remember(key, null); // don't retry this session; the page says "Your location"
  } finally {
    pending.delete(key);
  }
}

/**
 * The nearest place to these coordinates: a name, null when there isn't one (or it couldn't be found),
 * or undefined while looking it up. Pass null coordinates to skip.
 */
export function useNearestPlace(coords: { lat: number; lon: number } | null): string | null | undefined {
  const key = coords ? keyOf(coords.lat, coords.lon) : null;
  const name = useSyncExternalStore(
    subscribe,
    () => (key ? cache.get(key) : null),
    () => undefined,
  );
  useEffect(() => {
    if (key) void lookUp(key);
  }, [key]);
  return name;
}
