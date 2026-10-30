import { REQUEST_RADIUS_NM } from "./cells.js";

// The live sources: two free ADS-B networks (no key) that answer in the same format (readsb JSON).
// One request returns every aircraft within a radius of a point.
//   adsb.lol  first choice.  Data © adsb.lol contributors, Open Database License (ODbL).
//   adsb.fi   fallback.      Data © adsb.fi, for non-commercial use.
// Both limit requests per IP address. Supabase's Edge Functions share outgoing addresses with other
// projects, so either can refuse us (HTTP 429) even when we've made few requests; then the run
// tries the other one, and skips the refusing one for a cooldown.

const lat = (c) => c.lat.toFixed(4);
const lon = (c) => c.lon.toFixed(4);

/** In the order they're tried. */
export const SOURCES = [
  {
    name: "adsb.lol",
    url: (c) => `https://api.adsb.lol/v2/point/${lat(c)}/${lon(c)}/${REQUEST_RADIUS_NM}`,
    aircraft: (body) => body.ac,
  },
  {
    name: "adsb.fi",
    url: (c) => `https://opendata.adsb.fi/api/v2/lat/${lat(c)}/lon/${lon(c)}/dist/${REQUEST_RADIUS_NM}`,
    aircraft: (body) => body.aircraft,
  },
];

export const SOURCE_NAMES = SOURCES.map((s) => s.name);

export class RateLimited extends Error {
  constructor(source) {
    super(`${source} refused the request: rate limit reached (HTTP 429)`);
    this.source = source;
  }
}

/** The response's own clock in ms (adsb.lol sends ms, adsb.fi seconds), or ours if it has none. */
function clockMs(now) {
  if (typeof now !== "number") return Date.now();
  return now < 1e11 ? Math.round(now * 1000) : now;
}

/**
 * All aircraft within REQUEST_RADIUS_NM of a point, from one source.
 * Returns { aircraft, now } where `now` is the response's own clock in ms.
 * The timeout keeps a run (a few requests) under Cron's 30-second spacing, so runs don't overlap.
 */
export async function fetchCell(center, sourceName = SOURCES[0].name, { fetchImpl = fetch, timeoutMs = 5_000 } = {}) {
  const source = SOURCES.find((s) => s.name === sourceName);
  if (!source) throw new Error(`unknown source ${sourceName}`);
  const res = await fetchImpl(source.url(center), {
    headers: { Accept: "application/json", "User-Agent": "SkyHunt/0.1 (student project; Design, Build, Ship)" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 429) throw new RateLimited(source.name);
  if (!res.ok) throw new Error(`${source.name} answered HTTP ${res.status}`);
  const body = await res.json();
  const aircraft = source.aircraft(body);
  if (!Array.isArray(aircraft)) throw new Error(`${source.name}'s response had no aircraft list`);
  return { aircraft, now: clockMs(body.now) };
}
