const EARTH_RADIUS_MI = 3958.8;
const rad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in miles between two { lat, lon } points. */
export function distanceMi(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

/** Smallest difference between two compass headings, 0 to 180 degrees. */
export function headingDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
