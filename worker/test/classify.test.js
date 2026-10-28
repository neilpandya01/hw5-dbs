import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { airportZoneAt, classify, toSighting } from "../src/classify.js";

// A real adsb.lol response: everything within 25 nautical miles of downtown Chicago, saved Oct 28, 2026.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/chicago.json", import.meta.url), "utf8"));
const byHex = (hex) => fixture.ac.find((a) => a.hex === hex);
const CELL = "167_-351";

test("an airline flight on an airliner is commercial, with airline, type, and rarity", () => {
  const row = toSighting(byHex("aa2b21"), CELL, fixture.now); // RPA3416, Embraer 175, 35,000 ft
  assert.equal(row.kind, "commercial");
  assert.equal(row.airline_icao, "RPA");
  assert.equal(row.airline_name, "Republic Airlines");
  assert.equal(row.type_name, "Embraer 175");
  assert.equal(row.rarity, "common");
  assert.equal(row.alt_ft, 35000);
  assert.equal(row.heading, 84); // direction of travel, rounded
  assert.equal(row.cell, CELL);
});

test("seen_at is when the plane was pinged, not when we fetched", () => {
  const ac = byHex("aa2b21"); // seen_pos 0.109 s before the response
  const row = toSighting(ac, CELL, fixture.now);
  assert.equal(Date.parse(row.seen_at), Math.round(fixture.now - ac.seen_pos * 1000));
});

test("tail-number callsigns are private and not catchable", () => {
  const row = toSighting(byHex("a0a446"), CELL, fixture.now); // N140SF, a helicopter
  assert.equal(row.kind, "private");
  assert.equal(row.airline_name, null);
  assert.equal(row.rarity, null);
});

test("an airline-style callsign on a business jet is private (NetJets)", () => {
  assert.equal(classify("EJA746", "CL35", false).kind, "private");
});

test("missing callsign or type is unknown, and so is military", () => {
  assert.equal(toSighting(byHex("a2e96b"), CELL, fixture.now).kind, "unknown"); // EJA287, no type
  assert.equal(classify(null, "B738", false).kind, "unknown");
  assert.equal(classify("UAL1", "B738", true).kind, "unknown");
  assert.equal(classify("XQX123", "B738", false).kind, "unknown"); // airline code we don't know
});

test("planes on the ground and positions over a minute old are skipped", () => {
  assert.equal(toSighting(byHex("ab4af1"), CELL, fixture.now), null); // AAL1138 on the ground
  assert.equal(toSighting({ ...byHex("aa2b21"), seen_pos: 75 }, CELL, fixture.now), null);
  assert.equal(toSighting({ hex: "abc123", alt_baro: 3000 }, CELL, fixture.now), null); // no position
});

test("the saved response has 44 planes in the air, 9 on the ground", () => {
  const rows = fixture.ac.map((a) => toSighting(a, CELL, fixture.now)).filter(Boolean);
  assert.equal(fixture.ac.length, 53);
  assert.equal(rows.length, 44);
  assert.ok(rows.filter((r) => r.kind === "commercial").length >= 25);
});

test("planes over an airport's no-catch zone are marked with that airport", () => {
  assert.equal(airportZoneAt(41.9786, -87.9048), "ORD"); // O'Hare itself
  assert.equal(airportZoneAt(41.99, -87.87), "ORD"); // about 1.8 miles east
  assert.equal(airportZoneAt(41.88, -87.63), null); // downtown
});
