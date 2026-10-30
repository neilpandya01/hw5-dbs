import { REQUEST_RADIUS_NM } from "./cells.js";

// The live sources: two free ADS-B networks (no key) that answer in the same format (readsb JSON:
// `ac` is the list, `now` the response's clock in ms). One request returns every aircraft within a
// radius of a point.
//   adsb.fi   first choice: fast updates (one zone every 2 s) use only this one.
//             Limit: 1 request per second per IP; repeated errors (incl. 429) earn a temporary IP ban.
//             Personal, non-commercial use, with credit and a link. Data © adsb.fi.
//   adsb.lol  fallback, at the old pace (every 30 s, up to 4 zones), within our own 500-a-day budget.
//             Limit: "dynamic based on load", per IP. Data © adsb.lol contributors, ODbL.
// Supabase's Edge Functions share outgoing IP addresses with other projects, so either can refuse us
// (HTTP 429) even when we've made few requests. A source that refuses is skipped for 5 minutes.

const lat = (c) => c.lat.toFixed(4);
const lon = (c) => c.lon.toFixed(4);

/** In the order they're tried. */
export const SOURCES = [
  {
    name: "adsb.fi",
    url: (c) => `https://opendata.adsb.fi/api/v3/lat/${lat(c)}/lon/${lon(c)}/dist/${REQUEST_RADIUS_NM}`,
    // v3 answers like adsb.lol; the older v2 called the list `aircraft` (kept in case it comes back).
    aircraft: (body) => body.ac ?? body.aircraft,
  },
  {
    name: "adsb.lol",
    url: (c) => `https://api.adsb.lol/v2/point/${lat(c)}/${lon(c)}/${REQUEST_RADIUS_NM}`,
    aircraft: (body) => body.ac,
  },
];

export const SOURCE_NAMES = SOURCES.map((s) => s.name);

export class RateLimited extends Error {
  constructor(source) {
    super(`${source} refused the request: rate limit reached (HTTP 429)`);
    this.source = source;
  }
}

/** The response's own clock in ms (sent in ms; adsb.fi's old v2 sent seconds), or ours if it has none. */
function clockMs(now) {
  if (typeof now !== "number") return Date.now();
  return now < 1e11 ? Math.round(now * 1000) : now;
}

/**
 * All aircraft within REQUEST_RADIUS_NM of a point, from one source.
 * Returns { aircraft, now } where `now` is the response's own clock in ms.
 * The timeout keeps one slow answer from eating a whole fast-update window.
 */
export async function fetchCell(center, sourceName = SOURCES[0].name, { fetchImpl = fetch, timeoutMs = 4_000 } = {}) {
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
