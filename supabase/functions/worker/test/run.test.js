import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Budget, DAY_MS } from "../src/budget.js";
import { DAILY_SHARE, FI_DAILY_CAP } from "../src/limits.js";
import { COOLDOWN_MS, emptyState, loadState, runOnce } from "../src/run.js";
import { RateLimited } from "../src/source.js";

// Runs the worker against the saved response (fixtures/chicago.json, 53 aircraft, 44 in the air) and an
// in-memory stand-in for Supabase, with a fake clock that `sleep` moves forward. Checks: fast updates
// (one zone every 2 s, taking turns), only changes are saved, one bundle (frame) per zone update, the
// usage meter, the free-plan limits, and the adsb.lol fallback at the old 30-second pace.

const fixture = JSON.parse(readFileSync(new URL("./fixtures/chicago.json", import.meta.url), "utf8"));
const CHICAGO = { lat: 41.88, lon: -87.63 }; // zone 167_-351
const MILWAUKEE = { lat: 43.04, lon: -87.91 }; // zone 172_-352
const zones = (...points) => points;

function fakeDb({ hunters = [CHICAGO] } = {}) {
  const sightings = new Map();
  const db = {
    hunters,
    sightings,
    frames: [],
    runs: [],
    clock: () => 0,
    async activeHunters() {
      return db.hunters;
    },
    async loadSightings() {
      return [...sightings.values()].map((r) => ({ ...r }));
    },
    async upsertSightings(rows) {
      for (const r of rows) sightings.set(`${r.cell}|${r.hex}`, r);
    },
    async deleteSightings(keys) {
      for (const k of keys) sightings.delete(`${k.cell}|${k.hex}`);
    },
    async writeFrame(frame) {
      db.frames.push(structuredClone(frame));
    },
    async insertRun(run) {
      db.runs.push(run);
    },
    // Like worker_usage() in the database.
    async usage() {
      const now = db.clock();
      const recent = db.runs.filter((r) => Date.parse(r.started_at) > now - DAY_MS);
      const sum = (k) => recent.reduce((s, r) => s + r[k], 0);
      const limited = (source) => {
        const hits = recent.filter((r) => Date.parse(r.started_at) > now - COOLDOWN_MS && (r.error ?? "").includes(`${source} refused`));
        return hits.length ? hits.at(-1).started_at : null;
      };
      return {
        lol_24h: sum("lol_requests"),
        fi_24h: sum("fi_requests"),
        messages_24h: sum("messages_est"),
        bytes_24h: sum("bytes_est"),
        fi_limited_at: limited("adsb.fi"),
        lol_limited_at: limited("adsb.lol"),
        lol_events: recent.filter((r) => r.lol_requests > 0).map((r) => [Date.parse(r.started_at), r.lol_requests]),
      };
    },
  };
  return db;
}

/**
 * `respond` is a response (or Error) for every request, or a function of (source, cell, attempt number).
 * `fresh: true` reloads the state from the database before every call, like the Edge Function.
 */
function setup({ hunters, state = emptyState(), fresh = false } = {}) {
  const db = fakeDb({ hunters });
  let clock = fixture.now;
  db.clock = () => clock;
  const asked = [];
  let current = fixture;
  const deps = {
    db,
    fetchCell: async (center, source) => {
      asked.push({ source, at: clock, lat: center.lat });
      const answer = typeof current === "function" ? current(source, asked.length) : current;
      if (answer instanceof Error) throw answer;
      return { aircraft: structuredClone(answer.ac), now: clock };
    },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    log: () => {},
  };
  return {
    db,
    state,
    asked,
    respond: (r) => (current = r),
    advanceTo: (ms) => (clock = ms),
    nextCall: () => (clock = Date.parse(db.runs.at(-1).started_at) + 30_000),
    call: async () => {
      const s = fresh ? await loadState(db, clock) : state;
      return (await runOnce(s, deps)).run;
    },
  };
}

test("fast: one zone is updated every 2 seconds, all from adsb.fi", async () => {
  const t = setup();
  const run = await t.call();
  assert.equal(run.ok, true);
  assert.equal(run.mode, "fast");
  assert.equal(run.ticks, 11); // 0, 2, ... 20 s
  assert.equal(run.fi_requests, 11);
  assert.equal(run.lol_requests, 0);
  assert.deepEqual(new Set(t.asked.map((a) => a.source)), new Set(["adsb.fi"]));
  const gaps = t.asked.slice(1).map((a, i) => a.at - t.asked[i].at);
  assert.ok(gaps.every((g) => g >= 2_000), "at most one request every 2 s");
  assert.equal(run.upserted, 44); // the first answer: every plane in the air
  assert.equal(t.db.sightings.size, 44);
});

test("an unchanged answer writes nothing: one bundle for the first answer, none after", async () => {
  const t = setup();
  const run = await t.call();
  assert.equal(t.db.frames.length, 1);
  assert.equal(t.db.frames[0].planes.length, 44);
  // 1 bundle + 1 runs row, each to the 1 person watching.
  assert.equal(run.messages_est, 2);
  assert.ok(run.bytes_est > 10_000);
});

test("only the plane that moved goes in the next bundle", async () => {
  const t = setup();
  const moved = structuredClone(fixture);
  moved.ac.find((a) => a.hex === "aa2b21").lon += 0.02; // about a mile east
  t.respond((source, n) => (n === 1 ? fixture : moved));
  await t.call();
  assert.equal(t.db.frames.length, 2);
  assert.deepEqual(t.db.frames[1].planes.map((p) => p.hex), ["aa2b21"]);
  assert.deepEqual(t.db.frames[1].removed, []);
});

test("a plane that leaves is deleted and listed as removed in the bundle", async () => {
  const t = setup();
  const fewer = structuredClone(fixture);
  fewer.ac = fewer.ac.filter((a) => a.hex !== "aa2b21");
  t.respond((source, n) => (n === 1 ? fixture : fewer));
  const run = await t.call();
  assert.equal(run.deleted, 1);
  assert.deepEqual(t.db.frames[1].removed, ["aa2b21"]);
  assert.equal(t.db.sightings.has("167_-351|aa2b21"), false);
});

test("two zones take turns: each is updated every 4 seconds", async () => {
  const t = setup({ hunters: zones(CHICAGO, MILWAUKEE) });
  const run = await t.call();
  assert.equal(run.cells, 2);
  const lats = t.asked.map((a) => Math.round(a.lat));
  assert.deepEqual(lats.slice(0, 4), [42, 43, 42, 43]);
});

test("the usage estimate counts each bundle once per person watching that zone", async () => {
  const t = setup({ hunters: zones(CHICAGO, CHICAGO, CHICAGO) });
  const run = await t.call();
  assert.equal(run.cells, 1);
  assert.equal(run.messages_est, 3 * 1 + 3); // 1 bundle to 3 people, and the runs row to 3 people
});

test("nobody active: no requests, planes cleared, idle run recorded", async () => {
  const t = setup();
  await t.call();
  t.db.hunters = [];
  t.nextCall();
  const run = await t.call();
  assert.equal(run.mode, "idle");
  assert.equal(run.requests, 0);
  assert.equal(t.db.sightings.size, 0);
});

test("past half of today's free-plan share: 30-second updates (one request per zone)", async () => {
  const state = emptyState();
  state.messages24h = DAILY_SHARE.messages * 0.6;
  const t = setup({ state, hunters: zones(CHICAGO, MILWAUKEE) });
  const run = await t.call();
  assert.equal(run.mode, "normal");
  assert.equal(run.requests, 2);
  assert.equal(run.fi_requests, 2);
  assert.ok(t.asked[1].at - t.asked[0].at >= 1_000, "adsb.fi: at most 1 request a second");
});

test("past 90% of today's share (bytes count too): paused, no requests", async () => {
  const state = emptyState();
  state.bytes24h = DAILY_SHARE.bytes * 0.95;
  const t = setup({ state });
  const run = await t.call();
  assert.equal(run.mode, "paused");
  assert.equal(run.requests, 0);
  assert.equal(run.ok, true);
});

test("the 30-second pass covers at most 4 zones; fast takes turns among up to 8", async () => {
  const many = Array.from({ length: 6 }, (_, i) => ({ lat: 41.88 + i * 0.3, lon: -87.63 }));
  const slow = emptyState();
  slow.messages24h = DAILY_SHARE.messages * 0.6;
  const a = setup({ state: slow, hunters: many });
  assert.equal((await a.call()).requests, 4);
  const b = setup({ hunters: many });
  await b.call();
  assert.equal(new Set(b.asked.map((x) => x.lat)).size, 6);
});

test("adsb.fi refuses mid-call: the rest of the call falls back to adsb.lol at the old pace", async () => {
  const t = setup();
  t.respond((source, n) => (source === "adsb.fi" && n >= 3 ? new RateLimited("adsb.fi") : fixture));
  const run = await t.call();
  assert.equal(run.ok, true); // adsb.lol answered
  assert.equal(run.mode, "normal");
  assert.equal(run.fi_requests, 3);
  assert.equal(run.lol_requests, 1);
  assert.equal(run.source, "adsb.lol");
  assert.match(run.error, /adsb.fi refused/);
  // Next call: adsb.fi is cooling down, so it's adsb.lol, once, every 30 s.
  t.nextCall();
  const next = await t.call();
  assert.equal(next.mode, "normal");
  assert.equal(next.requests, 1);
  assert.equal(next.lol_requests, 1);
});

test("adsb.fi back after its cooldown: fast again", async () => {
  const t = setup({ fresh: true });
  t.respond((source, n) => (source === "adsb.fi" && n === 1 ? new RateLimited("adsb.fi") : fixture));
  await t.call();
  t.nextCall();
  assert.equal((await t.call()).mode, "normal"); // read back from `runs`: still cooling
  t.advanceTo(Date.parse(t.db.runs[0].started_at) + COOLDOWN_MS + 1_000);
  assert.equal((await t.call()).mode, "fast");
});

test("adsb.fi unavailable and adsb.lol's budget 75-90% used: slow, a request every other call", async () => {
  const state = emptyState();
  state.cooldowns["adsb.fi"] = Infinity;
  state.lolBudget = new Budget(500, [{ at: fixture.now - 3_600_000, requests: 400 }]);
  const t = setup({ state });
  const a = await t.call();
  assert.equal(a.mode, "slow");
  assert.equal(a.requests, 1);
  t.nextCall();
  const b = await t.call();
  assert.equal(b.mode, "slow");
  assert.equal(b.requests, 0);
  assert.equal(b.deleted, 0); // skipped, not emptied
  t.nextCall();
  assert.equal((await t.call()).requests, 1);
});

test("adsb.fi unavailable and adsb.lol's budget 90%+ used: paused, with a resume time", async () => {
  const state = emptyState();
  state.cooldowns["adsb.fi"] = fixture.now + 60_000;
  state.lolBudget = new Budget(500, [{ at: fixture.now - 3_600_000, requests: 460 }]);
  const t = setup({ state });
  const run = await t.call();
  assert.equal(run.mode, "paused");
  assert.equal(run.requests, 0);
  assert.equal(run.resume_at, new Date(fixture.now + 60_000).toISOString()); // adsb.fi's cooldown ends first
});

test("adsb.fi's daily cap reached: adsb.lol at the old pace", async () => {
  const state = emptyState();
  state.fi24h = FI_DAILY_CAP;
  const t = setup({ state });
  const run = await t.call();
  assert.equal(run.mode, "normal");
  assert.equal(run.fi_requests, 0);
  assert.equal(run.lol_requests, 1);
});

test("both sources refuse: failed, planes kept, and the next call is paused", async () => {
  const t = setup();
  await t.call();
  t.respond((source) => new RateLimited(source));
  t.advanceTo(Date.parse(t.db.runs[0].started_at) + COOLDOWN_MS * 2);
  const failed = await t.call();
  assert.equal(failed.ok, false);
  assert.equal(t.db.sightings.size, 44);
  t.nextCall();
  const paused = await t.call();
  assert.equal(paused.mode, "paused");
  assert.equal(paused.requests, 0);
});

test("fresh state each call: nothing rewritten, and usage adds up across calls", async () => {
  const t = setup({ fresh: true });
  const first = await t.call();
  t.nextCall();
  const second = await t.call();
  assert.equal(second.upserted, 0);
  assert.equal(second.fi_requests_24h, first.fi_requests + second.fi_requests);
  assert.equal(second.messages_24h, first.messages_est + second.messages_est);
});

test("if the saved state can't be read, the call makes no requests and is recorded as failed", async () => {
  const t = setup({ fresh: true });
  t.db.loadSightings = async () => {
    throw new Error("Supabase, loading sightings: timeout");
  };
  const run = await t.call();
  assert.equal(run.ok, false);
  assert.match(run.error, /loading sightings/);
  assert.equal(run.requests, 0);
  assert.equal(t.db.runs.length, 1);
});

// Soft daily limit: past 2 hours of Radar today, your zone gets 30-second updates (unless someone else
// watching it is still under 2 hours). You keep playing.
const PLAYED_OUT = { playDay: new Date(fixture.now).toISOString().slice(0, 10), playSeconds: 7200 };

test("everyone in a zone past 2 hours today: one update per call (every 30 s), still from adsb.fi", async () => {
  const t = setup({ hunters: [{ ...CHICAGO, ...PLAYED_OUT }] });
  const run = await t.call();
  assert.equal(run.mode, "normal");
  assert.equal(run.requests, 1);
  assert.equal(run.fi_requests, 1);
  assert.equal(t.db.frames[0].pace, "normal");
});

test("a slowed zone gets one turn per call between a fast zone's turns, 2 s apart", async () => {
  const t = setup({ hunters: [CHICAGO, { ...MILWAUKEE, ...PLAYED_OUT }] });
  const run = await t.call();
  assert.equal(run.mode, "fast");
  assert.equal(run.ticks, 11);
  const milwaukee = t.asked.filter((a) => Math.round(a.lat) === 43);
  assert.equal(milwaukee.length, 1);
  assert.equal(t.asked.length - milwaukee.length, 10);
  const gaps = t.asked.slice(1).map((a, i) => a.at - t.asked[i].at);
  assert.ok(gaps.every((g) => g >= 2_000));
  const paces = new Set(t.db.frames.map((f) => `${f.cell}:${f.pace}`));
  assert.ok(paces.has("167_-351:fast"));
  assert.ok(paces.has("172_-352:normal"));
});

test("a zone stays fast while anyone watching it is under 2 hours", async () => {
  const t = setup({ hunters: [{ ...CHICAGO, ...PLAYED_OUT }, CHICAGO] });
  const run = await t.call();
  assert.equal(run.mode, "fast");
  assert.equal(run.fi_requests, 11);
});

test("2 hours played on an earlier day doesn't count today", async () => {
  const t = setup({ hunters: [{ ...CHICAGO, playDay: "2026-10-01", playSeconds: 7200 }] });
  assert.equal((await t.call()).mode, "fast");
});
