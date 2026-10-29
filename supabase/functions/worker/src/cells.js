// The grid that groups players: cells 0.25° on a side (about 17 miles north-south, ~13 east-west
// in Chicago). Everyone in a cell shares one adsb.lol request. The page computes the same cell IDs
// (src/lib/cells.ts), so keep the two in step.

export const CELL_DEG = 0.25;

/** How far from you the page shows planes. */
export const VIEW_MI = 15;

/**
 * Each request is a circle around the cell's center, big enough to cover every point in the cell
 * plus the 15-mile view: half the cell's diagonal (at most 12.2 mi, at the equator) + 15 mi
 * = 27.2 mi, about 23.6 nautical miles. Rounded up.
 */
export const REQUEST_RADIUS_NM = 25;

/** "167_-351" for downtown Chicago. */
export function cellOf(lat, lon) {
  return `${Math.floor(lat / CELL_DEG)}_${Math.floor(lon / CELL_DEG)}`;
}

export function cellCenter(cell) {
  const [i, j] = cell.split("_").map(Number);
  return { lat: (i + 0.5) * CELL_DEG, lon: (j + 0.5) * CELL_DEG };
}
