import { REQUEST_RADIUS_NM } from "./cells.js";

// The live source: adsb.lol's free API (no key). One request returns every aircraft within a radius.
// Data © adsb.lol contributors, Open Database License (ODbL).

export class RateLimited extends Error {
  constructor() {
    super("adsb.lol refused the request: rate limit reached (HTTP 429)");
  }
}

/**
 * The timeout keeps a whole run (up to 4 requests) under Cron's 30-second spacing, so runs don't overlap.
 *
 * All aircraft within REQUEST_RADIUS_NM of a point.
 * Returns { aircraft, now } where `now` is the response's own clock in ms.
 */
export async function fetchCell(center, { fetchImpl = fetch, timeoutMs = 6_000 } = {}) {
  const url = `https://api.adsb.lol/v2/point/${center.lat.toFixed(4)}/${center.lon.toFixed(4)}/${REQUEST_RADIUS_NM}`;
  const res = await fetchImpl(url, {
    headers: { Accept: "application/json", "User-Agent": "SkyHunt/0.1 (student project; Design, Build, Ship)" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 429) throw new RateLimited();
  if (!res.ok) throw new Error(`adsb.lol answered HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body.ac)) throw new Error("adsb.lol's response had no aircraft list");
  return { aircraft: body.ac, now: typeof body.now === "number" ? body.now : Date.now() };
}
