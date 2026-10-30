import { Budget, DAILY_BUDGET, INTERVAL_S } from "./budget.js";
import { cellCenter, cellOf } from "./cells.js";
import { changed, keyOf } from "./changes.js";
import { toSighting } from "./classify.js";
import { FI_DAILY_CAP, MESSAGE_OVERHEAD_BYTES, paceFor, PLAY_LIMIT_S, RUN_MESSAGE_BYTES } from "./limits.js";
import { RateLimited } from "./source.js";

// One worker call. Supabase Cron calls the Edge Function every 30 seconds; each call starts from
// nothing (`loadState` reads what earlier calls left in the database) and lasts about 20 seconds:
//
//   1. Who's active? Hunters whose Radar checked in during the last minute, grouped into zones (grid cells).
//   2. How fast may we go today? (limits.js: the free plan's daily share, metered by the worker itself)
//   3a. fast:   adsb.fi, one zone every 2 seconds, taking turns (1 zone: each updated every 2 s;
//               2 zones: every 4 s; ... up to 8 zones). adsb.fi allows 1 request per second.
//               A zone where everyone watching has used today's 2 hours of Radar gets one turn per call
//               instead (every 30 s), slotted between the fast turns.
//   3b. normal: one pass over up to 4 zones, a request every 1.1 s: adsb.fi first, adsb.lol as fallback.
//               Used when today's fast allowance is spent, or adsb.fi is refusing (then adsb.lol, within
//               its 500-a-day budget: every 30 s, every 60 s when 75-90% used, paused at 90%).
//   4. For each zone fetched, save only the planes that changed, and write them as ONE `frames` row:
//      Realtime sends that as one message to each person watching the zone.
//   5. Record the call in `runs`: what it did, and its estimate of the Realtime messages and bytes it caused.

export const ACTIVE_WINDOW_MS = 60_000;
/** Fast updates: one zone per tick. */
export const TICK_MS = 2_000;
/** Ticks start at 0, 2, ... 20 s into the call (11 of them), so a call ends well before the next one. */
export const FAST_WINDOW_MS = 22_000;
export const MAX_FAST_ZONES = 8;
/** The 30-second pass, as before the fast mode: at most 4 zones, busiest first. */
export const MAX_PASS_ZONES = 4;
/** Spacing between requests in a pass (adsb.fi allows 1 request per second). */
export const REQUEST_GAP_MS = 1_100;
/** Start no new request in a pass after this long into the call. */
export const PASS_DEADLINE_MS = 23_000;
/** After a source refuses a request (HTTP 429), don't ask it again for this long. */
export const COOLDOWN_MS = 5 * 60_000;
/** Slow mode (adsb.lol only) requests every 60 s; Cron calls every 30 s, so every other call skips. */
export const SLOW_GAP_MS = INTERVAL_S.slow * 1000 - 5_000;

const FI = "adsb.fi";
const LOL = "adsb.lol";
const iso = (ms) => new Date(ms).toISOString();

/** Has this person used today's 2 hours of Radar (UTC day)? Past that, their updates slow to every 30 s. */
export function overPlayLimit(h, now) {
  return h.playDay === iso(now).slice(0, 10) && (h.playSeconds ?? 0) >= PLAY_LIMIT_S;
}

/**
 * Zones with someone active, busiest first: how many people are watching each, and how many of them
 * are still under today's 2 hours (`fastViewers`; a zone with none gets 30-second updates).
 */
export function zonesOf(hunters, now = Date.now()) {
  const zones = new Map();
  for (const h of hunters) {
    const cell = cellOf(h.lat, h.lon);
    const z = zones.get(cell) ?? { cell, viewers: 0, fastViewers: 0 };
    z.viewers += 1;
    if (!overPlayLimit(h, now)) z.fastViewers += 1;
    zones.set(cell, z);
  }
  return [...zones.values()].sort((a, b) => b.viewers - a.viewers || a.cell.localeCompare(b.cell));
}

/**
 * What a call needs from earlier calls, from the database: the planes already saved, and the last
 * 24 hours of usage (requests per source, estimated messages and bytes, recent refusals).
 * If reading fails, the call only records the failure (so the page shows "down").
 */
export async function loadState(db, now) {
  try {
    const [usage, sightings] = await Promise.all([db.usage(), db.loadSightings()]);
    const lolEvents = (usage.lol_events ?? []).map(([at, requests]) => ({ at: Number(at), requests: Number(requests) }));
    const cooldowns = {};
    if (usage.fi_limited_at) cooldowns[FI] = Date.parse(usage.fi_limited_at) + COOLDOWN_MS;
    if (usage.lol_limited_at) cooldowns[LOL] = Date.parse(usage.lol_limited_at) + COOLDOWN_MS;
    return {
      saved: new Map(sightings.map((row) => [keyOf(row), row])),
      lolBudget: new Budget(DAILY_BUDGET, lolEvents),
      lastLolRequestAt: lolEvents.reduce((latest, e) => Math.max(latest, e.at), 0),
      fi24h: Number(usage.fi_24h ?? 0),
      messages24h: Number(usage.messages_24h ?? 0),
      bytes24h: Number(usage.bytes_24h ?? 0),
      cooldowns,
    };
  } catch (e) {
    return { ...emptyState(), loadError: e.message };
  }
}

export function emptyState() {
  return {
    saved: new Map(),
    lolBudget: new Budget(DAILY_BUDGET, []),
    lastLolRequestAt: 0,
    fi24h: 0,
    messages24h: 0,
    bytes24h: 0,
    cooldowns: {},
  };
}

/**
 * @param state from loadState (or emptyState in tests; tests keep it between calls)
 * @param deps  { db, fetchCell(center, source), now?, sleep?, log? }
 * @returns { run }: the row written to `runs`
 */
export async function runOnce(state, deps) {
  const { db, fetchCell, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log } = deps;
  const started = now();
  const problems = []; // every problem, including ones a fallback recovered from
  const attempted = new Set();
  const answered = new Set();
  const cooldowns = (state.cooldowns ??= {});
  const run = {
    started_at: iso(started),
    finished_at: null,
    ok: true,
    mode: "idle",
    cells: 0,
    ticks: 0,
    requests: 0,
    fi_requests: 0,
    lol_requests: 0,
    requests_24h: 0,
    fi_requests_24h: 0,
    daily_budget: DAILY_BUDGET,
    upserted: 0,
    deleted: 0,
    rows_changed: 0,
    messages_est: 0,
    bytes_est: 0,
    messages_24h: 0,
    bytes_24h: 0,
    resume_at: null,
    error: null,
    source: null,
  };
  let viewers = new Map();
  let watching = 0;

  const coolingDown = (source) => now() < (cooldowns[source] ?? 0);
  const fiAvailable = () => !coolingDown(FI) && state.fi24h + run.fi_requests < FI_DAILY_CAP;

  /** Save the zone's planes that changed, as sightings and as one frame (one Realtime message per viewer). */
  async function applyZone(cell, fresh, pace) {
    const seen = new Set();
    const upserts = [];
    for (const row of fresh) {
      if (seen.has(row.hex)) continue; // a source can list a plane twice; keep the first
      seen.add(row.hex);
      if (changed(state.saved.get(keyOf(row)), row)) upserts.push(row);
    }
    const removed = [];
    for (const row of state.saved.values()) if (row.cell === cell && !seen.has(row.hex)) removed.push(row.hex);
    if (upserts.length) await db.upsertSightings(upserts);
    if (removed.length) await db.deleteSightings(removed.map((hex) => ({ cell, hex })));
    for (const row of upserts) state.saved.set(keyOf(row), row);
    for (const hex of removed) state.saved.delete(`${cell}|${hex}`);
    run.upserted += upserts.length;
    run.deleted += removed.length;
    if (!upserts.length && !removed.length) return;
    const t = now();
    const frame = { cell, seq: t, at: iso(t), pace, planes: upserts, removed };
    await db.writeFrame(frame);
    const v = viewers.get(cell) ?? 0;
    run.messages_est += v;
    run.bytes_est += v * (JSON.stringify(frame).length + MESSAGE_OVERHEAD_BYTES);
  }

  /** One request for one zone from one source. True if it answered and was saved. */
  async function fetchZone(cell, source, pace) {
    attempted.add(cell);
    run.requests += 1;
    if (source === FI) run.fi_requests += 1;
    else {
      run.lol_requests += 1;
      state.lolBudget.record(now(), 1);
      state.lastLolRequestAt = now();
    }
    try {
      const { aircraft, now: sourceNow } = await fetchCell(cellCenter(cell), source);
      const fresh = [];
      for (const ac of aircraft) {
        const row = toSighting(ac, cell, sourceNow);
        if (row) fresh.push(row);
      }
      await applyZone(cell, fresh, pace);
      answered.add(cell);
      run.source = source;
      return true;
    } catch (e) {
      problems.push(`${cell}: ${e.message}`);
      if (e instanceof RateLimited) cooldowns[source] = now() + COOLDOWN_MS;
      return false;
    }
  }

  /**
   * Fast: adsb.fi, one zone every 2 s in turn. Slowed zones (everyone there past 2 hours today) get one
   * turn each per call, on the odd ticks, so they're updated every 30 s and requests stay 2 s apart.
   * False if adsb.fi stopped answering partway.
   */
  async function fastLoop(fastCells, slowCells) {
    const slowQueue = [...slowCells];
    let next = 0;
    for (let k = 0; k * TICK_MS < FAST_WINDOW_MS; k++) {
      const wait = started + k * TICK_MS - now();
      if (wait > 0) await sleep(wait);
      if (!fiAvailable()) return false;
      run.ticks += 1;
      const slowTurn = slowQueue.length > 0 && k % 2 === 1;
      const cell = slowTurn ? slowQueue.shift() : fastCells[next++ % fastCells.length];
      if (!(await fetchZone(cell, FI, slowTurn ? "normal" : "fast"))) return false;
    }
    return true;
  }

  /**
   * The 30-second pass over up to 4 zones: adsb.fi if it's available, else adsb.lol within its budget.
   * Returns the mode it ran in.
   */
  async function pass(cells) {
    const lolMode = coolingDown(LOL) ? "paused" : state.lolBudget.mode(now());
    const useFi = fiAvailable();
    if (!useFi && lolMode === "paused") {
      const until = [cooldowns[FI] ?? 0, coolingDown(LOL) ? cooldowns[LOL] : state.lolBudget.resumeAt(now()) ?? 0];
      const soonest = Math.min(...until.filter((t) => t > now()));
      run.resume_at = Number.isFinite(soonest) ? iso(soonest) : null;
      return "paused";
    }
    const mode = useFi ? "normal" : lolMode;
    if (mode === "slow" && now() - state.lastLolRequestAt < SLOW_GAP_MS) return "slow"; // skip this call
    let first = true;
    for (const cell of cells) {
      if (now() - started > PASS_DEADLINE_MS) break; // the rest keep their planes until next time
      for (const source of [FI, LOL]) {
        if (source === FI && !fiAvailable()) continue;
        if (source === LOL && (coolingDown(LOL) || state.lolBudget.mode(now()) === "paused")) continue;
        if (!first) await sleep(REQUEST_GAP_MS);
        first = false;
        if (await fetchZone(cell, source, mode)) break;
      }
    }
    return mode;
  }

  try {
    // Without the saved planes and the usage so far, saving could rewrite everything or overspend.
    if (state.loadError) throw new Error(state.loadError);
    const hunters = await db.activeHunters(iso(started - ACTIVE_WINDOW_MS));
    const zones = zonesOf(hunters, started);
    viewers = new Map(zones.map((z) => [z.cell, z.viewers]));
    watching = hunters.length;
    run.cells = zones.length;

    // Zones nobody is in anymore: forget their planes (nobody's watching, so no message is sent).
    const gone = [...state.saved.values()].filter((row) => !viewers.has(row.cell));
    if (gone.length) {
      await db.deleteSightings(gone.map(({ cell, hex }) => ({ cell, hex })));
      for (const row of gone) state.saved.delete(keyOf(row));
      run.deleted += gone.length;
    }

    if (zones.length) {
      const pace = paceFor(state.messages24h, state.bytes24h);
      if (pace === "stop") {
        run.mode = "paused"; // today's share of the free plan is used up; resumes as old usage ages out
      } else if (pace === "fast" && fiAvailable() && zones.some((z) => z.fastViewers > 0)) {
        run.mode = "fast";
        const fastCells = zones.filter((z) => z.fastViewers > 0).slice(0, MAX_FAST_ZONES).map((z) => z.cell);
        const slowCells = zones.filter((z) => z.fastViewers === 0).slice(0, MAX_PASS_ZONES).map((z) => z.cell);
        const kept = await fastLoop(fastCells, slowCells);
        // adsb.fi stopped answering: finish this call the old way (adsb.lol, every 30 s).
        if (!kept) run.mode = await pass(zones.slice(0, MAX_PASS_ZONES).map((z) => z.cell));
      } else {
        // Today's fast allowance is used, adsb.fi is unavailable, or everyone active is past 2 hours.
        run.mode = await pass(zones.slice(0, MAX_PASS_ZONES).map((z) => z.cell));
      }
    }
  } catch (e) {
    problems.push(e.message);
    attempted.add("*");
  }

  // Failed only if a zone we asked about got no answer at all (or something else broke).
  const unanswered = [...attempted].filter((cell) => !answered.has(cell));
  run.ok = unanswered.length === 0;
  run.error = problems.length ? [...new Set(problems)].join("; ").slice(0, 1000) : null;
  run.rows_changed = run.upserted + run.deleted;
  // This row is itself a Realtime message to every open Radar.
  run.messages_est += watching;
  run.bytes_est += watching * RUN_MESSAGE_BYTES;
  run.requests_24h = state.lolBudget.used(now());
  run.fi_requests_24h = state.fi24h + run.fi_requests;
  run.messages_24h = state.messages24h + run.messages_est;
  run.bytes_24h = state.bytes24h + run.bytes_est;
  run.finished_at = iso(now());
  // Tests keep the state between calls; the Edge Function reloads it every call.
  state.fi24h = run.fi_requests_24h;
  state.messages24h = run.messages_24h;
  state.bytes24h = run.bytes_24h;
  try {
    await db.insertRun(run);
  } catch (e) {
    log(`[run] couldn't record this run: ${e.message}`);
  }

  log(
    `[run] ${run.started_at} ${run.ok ? "ok" : "FAILED"} mode=${run.mode} zones=${run.cells} ticks=${run.ticks} ` +
      `requests=${run.requests} (fi ${run.fi_requests}, lol ${run.lol_requests}; 24h: fi ${run.fi_requests_24h}, lol ${run.requests_24h}/${run.daily_budget})` +
      `${run.source ? ` source=${run.source}` : ""} upserted=${run.upserted} deleted=${run.deleted} ` +
      `est=${run.messages_est} msgs/${Math.round(run.bytes_est / 1024)} KB (24h: ${run.messages_24h} msgs/${Math.round(run.bytes_24h / 1048576)} MB)` +
      `${run.resume_at ? ` resume=${run.resume_at}` : ""}${run.error ? ` error="${run.error}"` : ""}`,
  );
  return { run };
}
