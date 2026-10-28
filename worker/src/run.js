import { INTERVAL_S } from "./budget.js";
import { cellCenter, cellOf } from "./cells.js";
import { keyOf, planChanges } from "./changes.js";
import { toSighting } from "./classify.js";
import { RateLimited } from "./source.js";

// One run of the worker:
//   1. Who's active? Hunters whose page checked in during the last minute, grouped into grid cells.
//   2. Pick the mode from the shared daily budget: normal, slow, paused, or idle (nobody active).
//   3. One adsb.lol request per active cell (at most 4 per run, busiest cells first).
//   4. Save only what changed: upsert new or moved planes, delete planes that left.
//   5. Record the run in `runs` (the page reads it to show fresh, stale, down, or limit reached).

export const ACTIVE_WINDOW_MS = 60_000;
export const MAX_CELLS_PER_RUN = 4;
/** Spacing between requests within a run (adsb.lol allows 4 per second, 60 per minute). */
export const REQUEST_GAP_MS = 300;
/** After adsb.lol refuses a request (HTTP 429), make no requests for this long. */
export const COOLDOWN_MS = 5 * 60_000;

const iso = (ms) => new Date(ms).toISOString();

/** Busiest cells first, so if there are more than 4, the most players get updates. */
export function activeCells(hunters) {
  const counts = new Map();
  for (const h of hunters) {
    const cell = cellOf(h.lat, h.lon);
    counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([cell]) => cell);
}

/**
 * @param state { saved: Map<key, row>, budget: Budget, cooldownUntil: ms }, kept between runs
 * @param deps  { db, fetchCell, now?, sleep?, log? }
 * @returns { run, waitS }: the row written to `runs`, and how long to wait before the next run
 */
export async function runOnce(state, deps) {
  const { db, fetchCell, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log } = deps;
  const started = now();
  const errors = [];
  const run = {
    started_at: iso(started),
    finished_at: null,
    ok: true,
    mode: "idle",
    cells: 0,
    requests: 0,
    requests_24h: 0,
    daily_budget: state.budget.budget,
    upserted: 0,
    deleted: 0,
    rows_changed: 0,
    resume_at: null,
    error: null,
  };

  try {
    const hunters = await db.activeHunters(iso(started - ACTIVE_WINDOW_MS));
    const cells = activeCells(hunters).slice(0, MAX_CELLS_PER_RUN);
    const active = new Set(cells);
    run.cells = cells.length;

    if (cells.length === 0) run.mode = "idle";
    else if (started < state.cooldownUntil) {
      run.mode = "paused";
      run.resume_at = iso(state.cooldownUntil);
    } else {
      run.mode = state.budget.mode(started);
      if (run.mode === "paused") run.resume_at = iso(state.budget.resumeAt(started));
    }

    const fresh = [];
    const fetched = new Set();
    if (run.mode === "normal" || run.mode === "slow") {
      for (const [i, cell] of cells.entries()) {
        if (i > 0) await sleep(REQUEST_GAP_MS);
        state.budget.record(now(), 1);
        run.requests += 1;
        try {
          const { aircraft, now: sourceNow } = await fetchCell(cellCenter(cell));
          for (const ac of aircraft) {
            const row = toSighting(ac, cell, sourceNow);
            if (row) fresh.push(row);
          }
          fetched.add(cell);
        } catch (e) {
          errors.push(`${cell}: ${e.message}`);
          if (e instanceof RateLimited) {
            state.cooldownUntil = now() + COOLDOWN_MS;
            break;
          }
        }
      }
    }

    // Paused or failed cells keep their planes for now (the page hides positions older than 2 minutes).
    // Cells nobody is in anymore are cleared.
    const { upserts, deletes } = planChanges(state.saved, fresh, fetched, active);
    if (upserts.length) await db.upsertSightings(upserts);
    if (deletes.length) await db.deleteSightings(deletes);
    for (const row of upserts) state.saved.set(keyOf(row), row);
    for (const key of deletes) state.saved.delete(keyOf(key));
    run.upserted = upserts.length;
    run.deleted = deletes.length;
    run.rows_changed = upserts.length + deletes.length;
  } catch (e) {
    errors.push(e.message);
  }

  run.requests_24h = state.budget.used(now());
  run.ok = errors.length === 0;
  run.error = errors.length ? errors.join("; ") : null;
  run.finished_at = iso(now());
  try {
    await db.insertRun(run);
  } catch (e) {
    log(`[run] couldn't record this run: ${e.message}`);
  }

  log(
    `[run] ${run.started_at} ${run.ok ? "ok" : "FAILED"} mode=${run.mode} cells=${run.cells} requests=${run.requests} ` +
      `(${run.requests_24h}/${run.daily_budget} in 24h) upserted=${run.upserted} deleted=${run.deleted}` +
      `${run.resume_at ? ` resume=${run.resume_at}` : ""}${run.error ? ` error="${run.error}"` : ""}`,
  );
  return { run, waitS: INTERVAL_S[run.mode] };
}
