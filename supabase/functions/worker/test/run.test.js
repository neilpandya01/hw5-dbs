import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Budget } from "../src/budget.js";
import { COOLDOWN_MS, loadState, runOnce } from "../src/run.js";
import { RateLimited } from "../src/source.js";

// Runs the worker against the saved adsb.lol response and an in-memory stand-in for Supabase,
// and checks what it saves: only what changed, planes that leave are deleted, every run is recorded.
// The Edge Function keeps nothing between calls, so the last tests rebuild the state from the
// stand-in database before every run, the way each Cron call does.

const fixture = JSON.parse(readFileSync(new URL("./fixtures/chicago.json", import.meta.url), "utf8"));
const CHICAGO = { lat: 41.88, lon: -87.63 }; // a hunter downtown (cell 167_-351)

function fakeDb({ hunters = [CHICAGO] } = {}) {
  const sightings = new Map();
  const db = {
    hunters,
    sightings,
    runs: [],
    upsertCalls: [],
    async activeHunters() {
      return db.hunters;
    },
    async upsertSightings(rows) {
      db.upsertCalls.push(rows.length);
      for (const r of rows) sightings.set(`${r.cell}|${r.hex}`, r);
    },
    async deleteSightings(keys) {
      for (const k of keys) sightings.delete(`${k.cell}|${k.hex}`);
    },
    async insertRun(run) {
      db.runs.push(run);
    },
    async loadSightings() {
      return [...sightings.values()].map((r) => ({ ...r }));
    },
    async requestHistory(sinceIso) {
      return db.runs
        .filter((r) => r.requests > 0 && r.started_at >= sinceIso)
        .map((r) => ({ at: Date.parse(r.started_at), requests: r.requests }));
    },
    async lastRateLimitedAt(sinceIso) {
      const hits = db.runs.filter((r) => r.started_at >= sinceIso && /HTTP 429/.test(r.error ?? ""));
      return hits.length ? Date.parse(hits.at(-1).started_at) : null;
    },
  };
  return db;
}

function setup({ response = fixture, hunters, budget = new Budget(500, []) } = {}) {
  const db = fakeDb({ hunters });
  let clock = fixture.now;
  let calls = 0;
  let current = response;
  const deps = {
    db,
    fetchCell: async () => {
      calls += 1;
      if (current instanceof Error) throw current;
      return { aircraft: structuredClone(current.ac), now: clock };
    },
    now: () => clock,
    sleep: async () => {},
    log: () => {},
  };
  const state = { saved: new Map(), budget, cooldownUntil: 0, lastRequestAt: 0 };
  return {
    db,
    state,
    deps,
    calls: () => calls,
    advance: (ms) => (clock += ms),
    respond: (r) => (current = r),
  };
}

test("first run saves every plane in the air and records the run", async () => {
  const t = setup();
  const { run } = await runOnce(t.state, t.deps);
  assert.equal(run.ok, true);
  assert.equal(run.mode, "normal");
  assert.equal(run.cells, 1);
  assert.equal(run.requests, 1);
  assert.equal(run.upserted, 44); // 53 aircraft, 9 on the ground
  assert.equal(run.deleted, 0);
  assert.equal(run.rows_changed, 44);
  assert.equal(t.db.sightings.size, 44);
  assert.equal(t.db.runs.length, 1);
});

test("an unchanged response 30 seconds later writes nothing", async () => {
  const t = setup();
  await runOnce(t.state, t.deps);
  t.advance(30_000);
  const { run } = await runOnce(t.state, t.deps);
  assert.equal(run.upserted, 0);
  assert.equal(run.deleted, 0);
  assert.equal(run.rows_changed, 0);
  assert.equal(t.db.runs.length, 2); // still recorded
});

test("only the plane that moved is saved again", async () => {
  const t = setup();
  await runOnce(t.state, t.deps);
  const moved = structuredClone(fixture);
  moved.ac.find((a) => a.hex === "aa2b21").lon += 0.02; // about a mile east
  t.respond(moved);
  t.advance(30_000);
  const { run } = await runOnce(t.state, t.deps);
  assert.equal(run.upserted, 1);
  assert.equal(t.db.sightings.get("167_-351|aa2b21").lon, moved.ac.find((a) => a.hex === "aa2b21").lon);
});

test("a plane that leaves is deleted", async () => {
  const t = setup();
  await runOnce(t.state, t.deps);
  const fewer = structuredClone(fixture);
  fewer.ac = fewer.ac.filter((a) => a.hex !== "aa2b21");
  t.respond(fewer);
  t.advance(30_000);
  const { run } = await runOnce(t.state, t.deps);
  assert.equal(run.deleted, 1);
  assert.equal(t.db.sightings.has("167_-351|aa2b21"), false);
});

test("nobody active: no request, planes cleared, idle run recorded", async () => {
  const t = setup();
  await runOnce(t.state, t.deps);
  t.db.hunters = [];
  t.advance(30_000);
  const { run } = await runOnce(t.state, t.deps);
  assert.equal(run.mode, "idle");
  assert.equal(run.requests, 0);
  assert.equal(t.calls(), 1);
  assert.equal(t.db.sightings.size, 0);
});

test("hunters in the same cell share one request", async () => {
  const t = setup({ hunters: [CHICAGO, { lat: 41.9, lon: -87.65 }, { lat: 41.8, lon: -87.7 }] });
  const { run } = await runOnce(t.state, t.deps);
  assert.equal(run.cells, 1);
  assert.equal(run.requests, 1);
});

test("75-90% of the daily budget slows to every 60 s; 90%+ pauses with no requests", async () => {
  const now = fixture.now;
  const slow = setup({ budget: new Budget(500, [{ at: now - 3600_000, requests: 400 }]) });
  const a = await runOnce(slow.state, slow.deps);
  assert.equal(a.run.mode, "slow");
  assert.equal(a.run.requests, 1);
  // Cron calls again 30 s later: still slow, so this run skips its request.
  slow.advance(30_000);
  const a2 = await runOnce(slow.state, slow.deps);
  assert.equal(a2.run.mode, "slow");
  assert.equal(a2.run.requests, 0);
  assert.equal(a2.run.deleted, 0); // skipped, not emptied
  // 60 s after the last request, it asks again.
  slow.advance(30_000);
  const a3 = await runOnce(slow.state, slow.deps);
  assert.equal(a3.run.requests, 1);

  const paused = setup({ budget: new Budget(500, [{ at: now - 3600_000, requests: 460 }]) });
  const b = await runOnce(paused.state, paused.deps);
  assert.equal(b.run.mode, "paused");
  assert.equal(b.run.requests, 0);
  assert.equal(paused.calls(), 0);
  assert.ok(b.run.resume_at);
  assert.equal(b.run.ok, true);
});

test("a failed fetch is recorded as failed and keeps the saved planes", async () => {
  const t = setup();
  await runOnce(t.state, t.deps);
  t.respond(new Error("adsb.lol answered HTTP 502"));
  t.advance(30_000);
  const { run } = await runOnce(t.state, t.deps);
  assert.equal(run.ok, false);
  assert.match(run.error, /502/);
  assert.equal(run.deleted, 0);
  assert.equal(t.db.sightings.size, 44);
});

test("a 429 from adsb.lol pauses requests for a cooldown", async () => {
  const t = setup();
  t.respond(new RateLimited());
  const first = await runOnce(t.state, t.deps);
  assert.equal(first.run.ok, false);
  t.advance(30_000);
  const second = await runOnce(t.state, t.deps);
  assert.equal(second.run.mode, "paused");
  assert.equal(t.calls(), 1);
});

// Like the Edge Function: every run starts from what the database says.
async function freshRun(t) {
  const state = await loadState(t.db, t.deps.now());
  return runOnce(state, t.deps);
}

test("fresh state each run: an unchanged response writes nothing, and the request count carries over", async () => {
  const t = setup();
  const first = await freshRun(t);
  assert.equal(first.run.upserted, 44);
  t.advance(30_000);
  const second = await freshRun(t);
  assert.equal(second.run.rows_changed, 0);
  assert.equal(second.run.requests_24h, 2);
});

test("fresh state each run: a 429 in an earlier run keeps requests paused for the cooldown", async () => {
  const t = setup();
  t.respond(new RateLimited());
  await freshRun(t);
  t.respond(fixture);
  t.advance(30_000);
  const paused = await freshRun(t);
  assert.equal(paused.run.mode, "paused");
  assert.equal(t.calls(), 1);
  t.advance(COOLDOWN_MS);
  const back = await freshRun(t);
  assert.equal(back.run.mode, "normal");
  assert.equal(t.calls(), 2);
});

test("if the saved state can't be read, the run makes no requests and is recorded as failed", async () => {
  const t = setup();
  t.db.loadSightings = async () => {
    throw new Error("Supabase, loading sightings: timeout");
  };
  const { run } = await freshRun(t);
  assert.equal(run.ok, false);
  assert.match(run.error, /loading sightings/);
  assert.equal(run.requests, 0);
  assert.equal(t.calls(), 0);
  assert.equal(t.db.runs.length, 1);
});
