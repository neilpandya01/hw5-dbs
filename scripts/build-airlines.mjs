// Builds supabase/functions/worker/data/airlines.json: ICAO airline code → [name, IATA code]. The worker uses it to tell
// commercial flights (callsign "UAL868" → United Airlines) from everything else, and the IATA code
// picks the airline's logo.
//
// Source: OpenFlights airlines.dat (Open Database License), https://openflights.org/data.php
//   curl -o airlines.dat https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat
//   node scripts/build-airlines.mjs airlines.dat
//
// OpenFlights hasn't been updated in years, so current airlines it lacks (or has without an IATA
// code) are added below by hand.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/build-airlines.mjs <airlines.dat>");
  process.exit(1);
}

const OVERRIDES = {
  ENY: ["Envoy Air", "MQ"],
  JIA: ["PSA Airlines", "OH"],
  EDV: ["Endeavor Air", "9E"],
  MXY: ["Breeze Airways", "MX"],
  VXP: ["Avelo Airlines", "XP"],
  FDX: ["FedEx Express", "FX"],
  UPS: ["UPS Airlines", "5X"],
  ABX: ["ABX Air", "GB"],
  ATN: ["Air Transport International", "8C"],
  GTI: ["Atlas Air", "5Y"],
  ROU: ["Air Canada Rouge", "RV"],
  VIV: ["Viva Aerobus", "VB"],
  CLX: ["Cargolux", "CV"],
  CJT: ["Cargojet", "W8"],
  AWI: ["Air Wisconsin", "ZW"],
  SCX: ["Sun Country Airlines", "SY"],
  NKS: ["Spirit Airlines", "NK"],
  FFT: ["Frontier Airlines", "F9"],
  AAY: ["Allegiant Air", "G4"],
};

/** Splits one CSV line, honoring quoted fields. */
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

// Columns: id, name, alias, IATA, ICAO, callsign, country, active
const airlines = {};
for (const line of readFileSync(input, "utf8").split(/\r?\n/)) {
  const f = splitCsvLine(line);
  if (f.length < 8) continue;
  const [, name, , iata, icao, , , active] = f;
  if (active !== "Y" || !/^[A-Z]{3}$/.test(icao)) continue;
  if (!airlines[icao]) airlines[icao] = [name, /^[A-Z0-9]{2}$/.test(iata) ? iata : null];
}
Object.assign(airlines, OVERRIDES);

const out = new URL("../supabase/functions/worker/data/", import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL("airlines.json", out), JSON.stringify(airlines));
console.log(`Wrote ${Object.keys(airlines).length} airlines to supabase/functions/worker/data/airlines.json`);
