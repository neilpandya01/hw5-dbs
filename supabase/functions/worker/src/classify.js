import airlines from "../data/airlines.json" with { type: "json" };
import airports from "../data/airports.json" with { type: "json" };
import { AIRLINER_TYPES } from "./aircraft.js";
import { distanceMi } from "./geo.js";

// Turns one aircraft from adsb.lol into a `sightings` row: who it is, whether it's a commercial
// flight (the only kind you can catch), and whether it's over an airport's no-catch zone.

// The data files are imported (not read from disk) so they're bundled with the Edge Function.

/** ICAO airline code → [name, IATA code or null]. Built by scripts/build-airlines.mjs. */
const AIRLINES = airlines;

/** [code, name, lat, lon, "L" | "M"]. Built by scripts/build-airports.mjs (same file the page uses). */
const AIRPORTS = airports.map(([code, , lat, lon, size]) => ({
  code,
  lat,
  lon,
  zoneMi: size === "L" ? 3 : 2,
}));

/** An airline flight's callsign: 3-letter ICAO airline code, then a flight number ("UAL868", "UAE3U"). */
const AIRLINE_CALLSIGN = /^([A-Z]{3})(\d[0-9A-Z]{0,3})$/;

/** Positions older than this are too old to show. */
const MAX_POSITION_AGE_S = 60;

/** The airport whose no-catch zone contains this point, if any. */
export function airportZoneAt(lat, lon) {
  for (const a of AIRPORTS) {
    // Cheap box check first (0.06° is more than 3 miles), then the real distance.
    if (Math.abs(a.lat - lat) > 0.06 || Math.abs(a.lon - lon) > 0.08) continue;
    if (distanceMi(a, { lat, lon }) <= a.zoneMi) return a.code;
  }
  return null;
}

/**
 * What kind of plane this is:
 *   commercial  airline callsign + an airline we know + an airliner type. Catchable.
 *   private     a tail-number callsign (N13HT), or a known airline code flying a non-airliner
 *               (e.g. NetJets business jets, callsign EJA…).
 *   unknown     no callsign, no aircraft type, military, or an airline-style callsign we don't recognize.
 */
export function classify(callsign, typeCode, military) {
  const match = callsign ? AIRLINE_CALLSIGN.exec(callsign) : null;
  const airline = match ? AIRLINES[match[1]] : undefined;
  const airliner = typeCode ? AIRLINER_TYPES[typeCode] : undefined;
  if (military) return { kind: "unknown" };
  if (match && airline && airliner) {
    return {
      kind: "commercial",
      airline: { icao: match[1], name: airline[0], iata: airline[1] ?? null },
      type: { name: airliner[0], rarity: airliner[1] },
    };
  }
  if (!callsign || !typeCode) return { kind: "unknown" };
  if (!match) return { kind: "private" };
  if (airline && !airliner) return { kind: "private" };
  return { kind: "unknown" };
}

/**
 * One adsb.lol aircraft → a sightings row for this cell, or null when it shouldn't be shown
 * (on the ground, no position, or a position more than a minute old).
 * `nowMs` is the response's own clock, so "seen_at" is when the plane was actually pinged.
 */
export function toSighting(ac, cell, nowMs) {
  if (typeof ac.lat !== "number" || typeof ac.lon !== "number") return null;
  if (ac.alt_baro === "ground") return null;
  const age = typeof ac.seen_pos === "number" ? ac.seen_pos : typeof ac.seen === "number" ? ac.seen : 0;
  if (age > MAX_POSITION_AGE_S) return null;

  const callsign = typeof ac.flight === "string" && ac.flight.trim() ? ac.flight.trim() : null;
  const typeCode = typeof ac.t === "string" && ac.t.trim() ? ac.t.trim().toUpperCase() : null;
  const military = typeof ac.dbFlags === "number" && (ac.dbFlags & 1) === 1;
  const c = classify(callsign, typeCode, military);
  const heading = typeof ac.track === "number" ? ac.track : typeof ac.true_heading === "number" ? ac.true_heading : null;

  return {
    cell,
    hex: String(ac.hex).toLowerCase(),
    callsign,
    kind: c.kind,
    airline_icao: c.airline?.icao ?? null,
    airline_iata: c.airline?.iata ?? null,
    airline_name: c.airline?.name ?? null,
    type_code: typeCode,
    type_name: c.type?.name ?? null,
    rarity: c.type?.rarity ?? null,
    lat: ac.lat,
    lon: ac.lon,
    alt_ft: typeof ac.alt_baro === "number" ? Math.round(ac.alt_baro) : null,
    speed_kt: typeof ac.gs === "number" ? Math.round(ac.gs) : null,
    heading: heading === null ? null : Math.round(heading),
    airport: airportZoneAt(ac.lat, ac.lon),
    seen_at: new Date(nowMs - age * 1000).toISOString(),
  };
}
