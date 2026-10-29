"use client";

import { useSyncExternalStore } from "react";
import { roundPosition, type LatLon } from "./geo";
import type { Rarity } from "./rarity";
import { describeToken, supabase } from "./supabase";

// The only data layer for a person's own data, saved in Supabase:
//   hunters   onboarding, rounded location, last active (row-level security: your own row only)
//   catches   your collection (made only by the catch_plane() database function, which checks the rules)
// Changes show at once, then save. A failed load or save shows StorageBanner.

export type Catch = {
  id: string;
  /** The aircraft's ICAO hex code, e.g. "a62d6e". */
  hex: string;
  callsign: string | null;
  /** ICAO airline code ("UAL"), its name, and IATA code ("UA", for the logo). */
  airlineCode: string | null;
  airlineName: string | null;
  airlineIata: string | null;
  /** ICAO type code ("B788") and its name ("Boeing 787-8"). */
  typeCode: string | null;
  typeName: string | null;
  rarity: Rarity;
  caughtAt: string;
};

export type SavedLocation = LatLon & { savedAt: string };

export type Data = {
  onboarded: boolean;
  /** Rounded to about 1 km. Tells the worker where to look for planes. */
  location: SavedLocation | null;
  catches: Catch[];
};

/** save-failed: a change wasn't saved. load-failed: your data couldn't be loaded. */
export type StorageStatus = "ok" | "save-failed" | "load-failed";

/** `problem` is the technical reason for a failed load or save, shown while developing. */
export type Snapshot = { userId: string; data: Data; storage: StorageStatus; problem?: string };

/** Supabase's error message and code (or a plain Error's message), for the console and the dev banner. */
function describe(e: unknown): string {
  if (e && typeof e === "object") {
    const { message, code, details, hint } = e as { message?: string; code?: string; details?: string; hint?: string };
    return [message, code && `(code ${code})`, details, hint].filter(Boolean).join(" ") || String(e);
  }
  return String(e);
}

type HunterRow = { onboarded: boolean; lat: number | string | null; lon: number | string | null; location_at: string | null };
type CatchRow = {
  id: string;
  hex: string;
  callsign: string | null;
  airline_icao: string | null;
  airline_name: string | null;
  airline_iata: string | null;
  type_code: string | null;
  type_name: string | null;
  rarity: Rarity;
  caught_at: string;
};

export const CATCH_COLUMNS = "id, hex, callsign, airline_icao, airline_name, airline_iata, type_code, type_name, rarity, caught_at";

export function toCatch(r: CatchRow): Catch {
  return {
    id: r.id,
    hex: r.hex,
    callsign: r.callsign,
    airlineCode: r.airline_icao,
    airlineName: r.airline_name,
    airlineIata: r.airline_iata,
    typeCode: r.type_code,
    typeName: r.type_name,
    rarity: r.rarity,
    caughtAt: r.caught_at,
  };
}

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

function set(next: Snapshot | null) {
  snapshot = next;
  emit();
}

const EMPTY: Data = { onboarded: false, location: null, catches: [] };

/** Bumped on every load (and sign-out), so a slow load for someone who has since signed out is ignored. */
let loadSeq = 0;

/** Called by AccountSync on sign-in (with the Clerk user ID) and on sign-out (null). */
export async function loadStore(userId: string | null) {
  const seq = ++loadSeq;
  if (!userId) return set(null);
  const sb = supabase();
  if (!sb) {
    const problem = "NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing from .env.local (restart npm run dev after adding them).";
    console.error(`[store] ${problem}`);
    return set({ userId, data: EMPTY, storage: "load-failed", problem });
  }
  try {
    const found = await sb.from("hunters").select("onboarded, lat, lon, location_at").maybeSingle();
    if (found.error) throw found.error;
    let hunter = found.data as HunterRow | null;
    if (!hunter) {
      // First visit: create this person's row (user_id comes from their Clerk token).
      const created = await sb.from("hunters").insert({ onboarded: false }).select("onboarded, lat, lon, location_at").single();
      if (created.error && created.error.code !== "23505") throw created.error;
      // 23505: another tab created it a moment ago; read that one.
      hunter = (created.data ??
        (await sb.from("hunters").select("onboarded, lat, lon, location_at").single()).data) as HunterRow | null;
      if (!hunter) throw new Error("Couldn't create your account's row");
    }
    const catches = await sb.from("catches").select(CATCH_COLUMNS).order("caught_at", { ascending: false });
    if (catches.error) throw catches.error;
    if (seq !== loadSeq) return; // signed out or switched while loading
    set({
      userId,
      storage: "ok",
      data: {
        onboarded: hunter.onboarded,
        location:
          hunter.lat !== null && hunter.lon !== null
            ? { lat: Number(hunter.lat), lon: Number(hunter.lon), savedAt: hunter.location_at ?? "" }
            : null,
        catches: (catches.data as CatchRow[]).map(toCatch),
      },
    });
  } catch (e) {
    let problem = describe(e);
    // 42501 "permission denied": Supabase saw this request as signed out. Say what Clerk's token
    // contains (and drop Supabase's hint to grant access to anon, which would be the wrong fix).
    if ((e as { code?: string })?.code === "42501") {
      problem = `${(e as { message?: string }).message} (code 42501). Supabase treated you as signed out. ${await describeToken()}.`;
    }
    console.error(`[store] Couldn't load your account: ${problem}`);
    if (seq === loadSeq) set({ userId, data: EMPTY, storage: "load-failed", problem });
  }
}

/**
 * Shows the change at once, then writes it. Resolves true only if the database really changed a row:
 * an update that row-level security filters out "succeeds" with zero rows, which counts as a failure.
 */
async function save(change: (d: Data) => Data, write: () => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<boolean> {
  if (!snapshot || snapshot.storage === "load-failed") return false;
  const before = snapshot;
  set({ ...before, data: change(before.data) });
  const { data, error } = await write();
  const ok = !error && Array.isArray(data) && data.length > 0;
  if (!ok) {
    const problem = error ? describe(error) : "The update changed no rows (row-level security didn't match your account).";
    console.error(`[store] Couldn't save: ${problem}`);
    if (snapshot?.userId === before.userId) set({ ...snapshot, data: before.data, storage: "save-failed", problem });
  }
  return ok;
}

/** Saves where someone is, rounded to about 1 km. The exact position is never saved. Resolves false if it didn't save. */
export async function saveLocation(p: LatLon): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;
  const r = roundPosition(p);
  const now = new Date().toISOString();
  return save(
    (d) => ({ ...d, location: { ...r, savedAt: now } }),
    () => sb.from("hunters").update({ lat: r.lat, lon: r.lon, location_at: now }).eq("user_id", snapshot!.userId).select("user_id"),
  );
}

export async function finishOnboarding(): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;
  return save(
    (d) => ({ ...d, onboarded: true }),
    () => sb.from("hunters").update({ onboarded: true }).eq("user_id", snapshot!.userId).select("user_id"),
  );
}

/** "I'm still here": the worker only fetches planes near people active in the last minute. */
export async function touchHunter(): Promise<boolean> {
  const sb = supabase();
  if (!sb || !snapshot) return false;
  const { error } = await sb.rpc("touch_hunter");
  return !error;
}

/** Why a catch was refused, from catch_plane()'s error codes. */
export type CatchError =
  | "NOT_COMMERCIAL"
  | "STALE"
  | "AIRPORT_ZONE"
  | "OUT_OF_RANGE"
  | "ALREADY_CAUGHT"
  | "GONE"
  | "NO_LOCATION"
  | "FAILED";

const CODES: CatchError[] = ["NOT_COMMERCIAL", "STALE", "AIRPORT_ZONE", "OUT_OF_RANGE", "ALREADY_CAUGHT", "GONE", "NO_LOCATION"];

/**
 * Catch a plane. The database checks the rules against the plane's last ping and where you are
 * (rounded to about 1 km before sending), and adds it to your collection.
 */
export async function catchPlane(cell: string, hex: string, me: LatLon): Promise<{ ok: true; caught: Catch } | { ok: false; error: CatchError }> {
  const sb = supabase();
  if (!sb || !snapshot) return { ok: false, error: "FAILED" };
  // Rounded here, before it leaves the browser: the exact position is never sent anywhere.
  const r = roundPosition(me);
  const { data, error } = await sb.rpc("catch_plane", { p_cell: cell, p_hex: hex, p_lat: r.lat, p_lon: r.lon });
  if (error) {
    const code = CODES.find((c) => error.message?.includes(c));
    return { ok: false, error: code ?? "FAILED" };
  }
  const caught = toCatch(data as CatchRow);
  if (snapshot) set({ ...snapshot, data: { ...snapshot.data, catches: [caught, ...snapshot.data.catches] } });
  return { ok: true, caught };
}

export function isNewUser(s: Snapshot): boolean {
  return !s.data.onboarded;
}
