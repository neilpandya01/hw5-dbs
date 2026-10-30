import { distanceMi, headingDiff } from "./geo.js";

// Decides which planes to write. Each zone update is one Realtime message to every person watching,
// and its size grows with the planes in it, so only real changes are included:
//   - a new plane
//   - moved a quarter mile or more, climbed or descended 300+ ft, or turned 10+ degrees
//   - its callsign, type, kind, or airport zone changed
//   - or a minute has passed since the last save (so "updated X s ago" stays honest for slow planes)
// Planes missing from a zone's latest answer, or in a zone nobody is in anymore, are deleted (run.js).

export const MOVE_MI = 0.25;
export const ALT_FT = 300;
export const TURN_DEG = 10;
export const REFRESH_MS = 60_000;

export const keyOf = (row) => `${row.cell}|${row.hex}`;

/** Should `next` be written, given the last saved version `prev`? */
export function changed(prev, next) {
  if (!prev) return true;
  if (prev.kind !== next.kind || prev.type_code !== next.type_code || prev.callsign !== next.callsign) return true;
  if (prev.airport !== next.airport) return true;
  if (distanceMi(prev, next) >= MOVE_MI) return true;
  if (prev.alt_ft !== null && next.alt_ft !== null && Math.abs(prev.alt_ft - next.alt_ft) >= ALT_FT) return true;
  if ((prev.alt_ft === null) !== (next.alt_ft === null)) return true;
  if (prev.heading !== null && next.heading !== null && headingDiff(prev.heading, next.heading) >= TURN_DEG) return true;
  return Date.parse(next.seen_at) - Date.parse(prev.seen_at) >= REFRESH_MS;
}
