import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Budget } from "../src/budget.js";
import { runOnce } from "../src/run.js";
import { RateLimited } from "../src/source.js";

// Runs the worker against the saved adsb.lol response and an in-memory stand-in for Supabase,
// and checks what it saves: only what changed, planes that leave are deleted, every run is recorded.

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
  const state = { saved: new Map(), budget, cooldownUntil: 0 };
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
  const { run, waitS } = await runOnce(t.state, t.deps);
  assert.equal(run.ok, true);
  assert.equal(run.mode, "normal");
  assert.equal(run.cells, 1);
  assert.equal(run.requests, 1);
  assert.equal(run.upserted, 44); // 53 aircraft, 9 on the ground
  assert.equal(run.deleted, 0);
  assert.equal(run.rows_changed, 44);
  assert.equal(t.db.sightings.size, 44);
  assert.equal(t.db.runs.length, 1);
  assert.equal(waitS, 30);
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
  assert.equal(a.waitS, 60);

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
