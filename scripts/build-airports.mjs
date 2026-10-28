// Builds public/airports.json (and the worker's copy): the airports with scheduled passenger service, whose surroundings
// are no-catch zones on the map.
//
// Source: OurAirports (public domain), https://ourairports.com/data/
//   curl -o airports.csv https://davidmegginson.github.io/ourairports-data/airports.csv
//   node scripts/build-airports.mjs airports.csv
//
// Output rows are compact arrays: [code, name, lat, lon, size], where size is "L" (large) or "M" (medium).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/build-airports.mjs <airports.csv>");
  process.exit(1);
}

/** Splits one CSV line, honoring quoted fields (which may contain commas and doubled quotes). */
function splitCsvLine(line) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

const lines = readFileSync(input, "utf8").split(/\r?\n/).filter(Boolean);
const header = splitCsvLine(lines[0]);
const col = (name) => header.indexOf(name);
const [TYPE, NAME, LAT, LON, SCHEDULED, IATA, ICAO, IDENT] = [
  "type",
  "name",
  "latitude_deg",
  "longitude_deg",
  "scheduled_service",
  "iata_code",
  "icao_code",
  "ident",
].map(col);

const rows = [];
for (const line of lines.slice(1)) {
  const f = splitCsvLine(line);
  const type = f[TYPE];
  if ((type !== "large_airport" && type !== "medium_airport") || f[SCHEDULED] !== "yes") continue;
  const lat = Number(f[LAT]);
  const lon = Number(f[LON]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  rows.push([
    f[IATA] || f[ICAO] || f[IDENT],
    f[NAME],
    Math.round(lat * 1e4) / 1e4,
    Math.round(lon * 1e4) / 1e4,
    type === "large_airport" ? "L" : "M",
  ]);
}

// The page draws the zones; the worker marks planes inside them so they can't be caught.
const json = JSON.stringify(rows);
writeFileSync(new URL("../public/airports.json", import.meta.url), json);
mkdirSync(new URL("../worker/data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../worker/data/airports.json", import.meta.url), json);
console.log(`Wrote ${rows.length} airports to public/airports.json and worker/data/airports.json`);
