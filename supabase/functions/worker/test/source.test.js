import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchCell, RateLimited } from "../src/source.js";

// The two sources answer in the same format with two differences: adsb.lol calls the list `ac` and
// sends its clock in ms; adsb.fi calls it `aircraft` and sends seconds.

const CHICAGO = { lat: 41.875, lon: -87.625 };
const plane = { hex: "aa2b21", flight: "RPA3416 ", t: "E75L", lat: 41.9, lon: -87.7, alt_baro: 35000 };

const answer = (status, body) => async (url) => {
  answer.lastUrl = url;
  return { status, ok: status >= 200 && status < 300, json: async () => body };
};

test("adsb.lol: reads `ac` and a clock in ms", async () => {
  const r = await fetchCell(CHICAGO, "adsb.lol", { fetchImpl: answer(200, { ac: [plane], now: 1793318994002 }) });
  assert.equal(answer.lastUrl, "https://api.adsb.lol/v2/point/41.8750/-87.6250/25");
  assert.equal(r.aircraft.length, 1);
  assert.equal(r.now, 1793318994002);
});

test("adsb.fi: reads `aircraft` and turns its clock in seconds into ms", async () => {
  const r = await fetchCell(CHICAGO, "adsb.fi", { fetchImpl: answer(200, { aircraft: [plane], now: 1793318994.002 }) });
  assert.equal(answer.lastUrl, "https://opendata.adsb.fi/api/v2/lat/41.8750/lon/-87.6250/dist/25");
  assert.equal(r.aircraft[0].hex, "aa2b21");
  assert.equal(r.now, 1793318994002);
});

test("a 429 says which source refused", async () => {
  await assert.rejects(fetchCell(CHICAGO, "adsb.fi", { fetchImpl: answer(429, {}) }), (e) => {
    assert.ok(e instanceof RateLimited);
    assert.equal(e.source, "adsb.fi");
    assert.match(e.message, /^adsb.fi refused/);
    return true;
  });
});

test("an answer without an aircraft list is an error", async () => {
  await assert.rejects(fetchCell(CHICAGO, "adsb.lol", { fetchImpl: answer(200, { msg: "busy" }) }), /no aircraft list/);
});
