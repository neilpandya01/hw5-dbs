"use client";

import { useEffect, useState } from "react";
import type { Rarity } from "./rarity";
import { supabase } from "./supabase";

// Live planes for one grid cell, kept current by Supabase Realtime:
//   - load the cell's planes and the worker's latest run
//   - then listen: new or moved planes (filtered to this cell), planes removed, and each new run
// On (re)subscribing and on returning to the tab, it reloads, so nothing missed while away sticks.

export type Kind = "commercial" | "private" | "unknown";

export type Sighting = {
  cell: string;
  hex: string;
  callsign: string | null;
  kind: Kind;
  airlineCode: string | null;
  airlineIata: string | null;
  airlineName: string | null;
  typeCode: string | null;
  typeName: string | null;
  rarity: Rarity | null;
  lat: number;
  lon: number;
  altFt: number | null;
  /** Direction of travel, degrees from north. */
  heading: number | null;
  /** Airport code if its last ping was over that airport's no-catch zone. */
  airport: string | null;
  /** When its position was last pinged, in ms. */
  seenAt: number;
};

export type RunMode = "normal" | "slow" | "paused" | "idle";

export type Run = {
  finishedAt: number;
  ok: boolean;
  mode: RunMode;
  resumeAt: number | null;
  requests24h: number;
  dailyBudget: number;
};

type SightingRow = {
  cell: string;
  hex: string;
  callsign: string | null;
  kind: Kind;
  airline_icao: string | null;
  airline_iata: string | null;
  airline_name: string | null;
  type_code: string | null;
  type_name: string | null;
  rarity: Rarity | null;
  lat: number;
  lon: number;
  alt_ft: number | null;
  heading: number | null;
  airport: string | null;
  seen_at: string;
};

type RunRow = {
  started_at: string;
  finished_at: string | null;
  ok: boolean;
  mode: RunMode;
  resume_at: string | null;
  requests_24h: number;
  daily_budget: number;
};

const SIGHTING_COLUMNS =
  "cell, hex, callsign, kind, airline_icao, airline_iata, airline_name, type_code, type_name, rarity, lat, lon, alt_ft, heading, airport, seen_at";
const RUN_COLUMNS = "started_at, finished_at, ok, mode, resume_at, requests_24h, daily_budget";

function toSighting(r: SightingRow): Sighting {
  return {
    cell: r.cell,
    hex: r.hex,
    callsign: r.callsign,
    kind: r.kind,
    airlineCode: r.airline_icao,
    airlineIata: r.airline_iata,
    airlineName: r.airline_name,
    typeCode: r.type_code,
    typeName: r.type_name,
    rarity: r.rarity,
    lat: r.lat,
    lon: r.lon,
    altFt: r.alt_ft,
    heading: r.heading,
    airport: r.airport,
    seenAt: Date.parse(r.seen_at),
  };
}

function toRun(r: RunRow): Run {
  return {
    finishedAt: Date.parse(r.finished_at ?? r.started_at),
    ok: r.ok,
    mode: r.mode,
    resumeAt: r.resume_at ? Date.parse(r.resume_at) : null,
    requests24h: r.requests_24h,
    dailyBudget: r.daily_budget,
  };
}

export type FlightsState = {
  /** False until the first load answers. */
  loaded: boolean;
  /** The database or Realtime couldn't be reached. */
  error: boolean;
  planes: Sighting[];
  run: Run | null;
};

const INITIAL: FlightsState = { loaded: false, error: false, planes: [], run: null };

export function useFlights(cell: string | null): FlightsState {
  const [state, setState] = useState<{ cell: string | null; flights: FlightsState }>({ cell, flights: INITIAL });

  useEffect(() => {
    const sb = supabase();
    if (!cell || !sb) return;
    let cancelled = false;
    const planes = new Map<string, Sighting>();
    const publish = (patch: Partial<FlightsState>) =>
      !cancelled && setState((s) => ({ cell, flights: { ...(s.cell === cell ? s.flights : INITIAL), ...patch, planes: [...planes.values()] } }));

    async function load() {
      const [s, r] = await Promise.all([
        sb!.from("sightings").select(SIGHTING_COLUMNS).eq("cell", cell),
        sb!.from("runs").select(RUN_COLUMNS).order("started_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (cancelled) return;
      if (s.error || r.error) return publish({ loaded: true, error: true });
      planes.clear();
      for (const row of s.data as SightingRow[]) planes.set(row.hex, toSighting(row));
      publish({ loaded: true, error: false, run: r.data ? toRun(r.data as RunRow) : null });
    }

    const filter = `cell=eq.${cell}`;
    const channel = sb
      .channel(`flights:${cell}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sightings", filter }, (p) => {
        const row = toSighting(p.new as SightingRow);
        planes.set(row.hex, row);
        publish({});
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "sightings", filter }, (p) => {
        const row = toSighting(p.new as SightingRow);
        planes.set(row.hex, row);
        publish({});
      })
      // Deletes can't be filtered by Realtime; each carries the row's key (cell, hex), so check the cell here.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "sightings" }, (p) => {
        const old = p.old as Partial<SightingRow>;
        if (old.cell === cell && old.hex && planes.delete(old.hex)) publish({});
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "runs" }, (p) => {
        publish({ run: toRun(p.new as RunRow) });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void load();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") publish({ loaded: true, error: true });
      });

    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sb.removeChannel(channel);
    };
  }, [cell]);

  return state.cell === cell ? state.flights : INITIAL;
}

/**
 * The current time, ticking every `ms` (for "updated 12 s ago" and freshness).
 * 0 until the page is in the browser: reading the clock while Next.js pre-renders isn't allowed.
 */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    queueMicrotask(() => setNow(Date.now()));
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
