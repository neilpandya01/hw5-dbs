// The grid that groups players: cells 0.25° on a side. The worker makes one request per cell with
// someone active, and saves each plane under that cell; the page listens to its own cell.
// Must match worker/src/cells.js exactly.

export const CELL_DEG = 0.25;

/** "167_-351" for downtown Chicago. */
export function cellOf(lat: number, lon: number): string {
  return `${Math.floor(lat / CELL_DEG)}_${Math.floor(lon / CELL_DEG)}`;
}
