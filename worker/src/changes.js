import { distanceMi, headingDiff } from "./geo.js";

// Decides which planes to write. Supabase Realtime sends every changed row to every open page,
// so only real changes are saved:
//   - a new plane
//   - moved a quarter mile or more, climbed or descended 300+ ft, or turned 10+ degrees
//   - its callsign, type, kind, or airport zone changed
//   - or a minute has passed since the last save (so "updated X s ago" stays honest for slow planes)
// Planes that are gone from a cell we just fetched, or whose cell nobody is in anymore, are deleted.

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

/**
 * @param saved        Map of key → the last row written for each plane
 * @param fresh        rows from this run's successful fetches
 * @param fetchedCells cells fetched successfully this run (a failed cell keeps its planes for now)
 * @param activeCells  cells with someone active (planes in other cells are deleted)
 */
export function planChanges(saved, fresh, fetchedCells, activeCells) {
  const upserts = [];
  const seen = new Set();
  for (const row of fresh) {
    const key = keyOf(row);
    if (seen.has(key)) continue; // adsb.lol can list a plane twice; keep the first
    seen.add(key);
    if (changed(saved.get(key), row)) upserts.push(row);
  }
  const deletes = [];
  for (const [key, row] of saved) {
    const gone = fetchedCells.has(row.cell) && !seen.has(key);
    if (gone || !activeCells.has(row.cell)) deletes.push({ cell: row.cell, hex: row.hex });
  }
  return { upserts, deletes };
}
