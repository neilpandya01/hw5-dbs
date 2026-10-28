import assert from "node:assert/strict";
import { test } from "node:test";
import { Budget, DAY_MS, INTERVAL_S, modeFor } from "../src/budget.js";

test("under 75% is normal (30 s), 75-90% is slow (60 s), 90% and up is paused", () => {
  assert.equal(modeFor(374, 500), "normal");
  assert.equal(modeFor(375, 500), "slow");
  assert.equal(modeFor(449, 500), "slow");
  assert.equal(modeFor(450, 500), "paused");
  assert.equal(INTERVAL_S.normal, 30);
  assert.equal(INTERVAL_S.slow, 60);
});

test("only the last 24 hours count", () => {
  const now = 1_800_000_000_000;
  const b = new Budget(500, [
    { at: now - DAY_MS - 1, requests: 300 }, // older than a day: ignored
    { at: now - 1000, requests: 10 },
  ]);
  assert.equal(b.used(now), 10);
  b.record(now, 1);
  assert.equal(b.used(now), 11);
});

test("when paused, it says when enough old requests will have aged out", () => {
  const now = 1_800_000_000_000;
  const b = new Budget(500, [
    { at: now - 20 * 3600_000, requests: 100 },
    { at: now - 60_000, requests: 360 },
  ]);
  assert.equal(b.mode(now), "paused"); // 460 of 500
  // Dropping the 100 from 20 hours ago leaves 360 (under 450), 4 hours from now.
  assert.equal(b.resumeAt(now), now - 20 * 3600_000 + DAY_MS);
  assert.equal(new Budget(500, []).resumeAt(now), null);
});
