// Small geometry helpers for positions on the radar. Plain functions, no browser APIs.

export type LatLon = { lat: number; lon: number };

/** How far around you a plane can be caught. */
export const CATCH_RANGE_MI = 10;

/** 2 decimals is about 1 km: the precision we save and send anywhere. Never store an exact position. */
export function roundCoord(n: number): number {
  return Math.round(n * 100) / 100;
}

export function roundPosition(p: LatLon): LatLon {
  return { lat: roundCoord(p.lat), lon: roundCoord(p.lon) };
}

const EARTH_RADIUS_MI = 3958.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in miles. */
export function distanceMi(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

/**
 * Where a point sits relative to a center, in miles east (x) and north (y).
 * Flat-earth approximation: accurate enough within a radar's few dozen miles.
 */
export function offsetMi(center: LatLon, p: LatLon): { x: number; y: number } {
  const milesPerDegLat = 69.0;
  return {
    x: (p.lon - center.lon) * milesPerDegLat * Math.cos(rad(center.lat)),
    y: (p.lat - center.lat) * milesPerDegLat,
  };
}

/** The inverse of offsetMi: a position some miles east (x) and north (y) of a center. */
export function moveBy(center: LatLon, x: number, y: number): LatLon {
  const milesPerDegLat = 69.0;
  return {
    lat: center.lat + y / milesPerDegLat,
    lon: center.lon + x / (milesPerDegLat * Math.cos(rad(center.lat))),
  };
}

/** Compass direction for a bearing in degrees: 0 → "north", 90 → "east". */
export function compass(deg: number): string {
  const names = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
