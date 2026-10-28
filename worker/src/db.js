import { createClient } from "@supabase/supabase-js";

// Everything the worker reads and writes in Supabase. It uses the SECRET key, which skips row-level
// security: it must only ever come from the environment (Railway's variables, or worker/.env locally).

const SIGHTING_COLUMNS =
  "cell, hex, callsign, kind, airline_icao, airline_iata, airline_name, type_code, type_name, rarity, lat, lon, alt_ft, speed_kt, heading, airport, seen_at";

function check({ data, error }, what) {
  if (error) throw new Error(`Supabase, ${what}: ${error.message}`);
  return data;
}

export function createDb(url, secretKey) {
  const sb = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

  return {
    /** Rounded locations of everyone active since `sinceIso`. */
    async activeHunters(sinceIso) {
      const rows = check(
        await sb.from("hunters").select("lat, lon").gte("last_active_at", sinceIso).not("lat", "is", null).not("lon", "is", null),
        "reading active hunters",
      );
      return rows.map((r) => ({ lat: Number(r.lat), lon: Number(r.lon) }));
    },

    /** Every saved plane, so a restarted worker knows what's already there. */
    async loadSightings() {
      return check(await sb.from("sightings").select(SIGHTING_COLUMNS), "loading sightings");
    },

    async upsertSightings(rows) {
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500).map((r) => ({ ...r, updated_at: new Date().toISOString() }));
        check(await sb.from("sightings").upsert(batch, { onConflict: "cell,hex" }), "saving sightings");
      }
    },

    async deleteSightings(keys) {
      const byCell = new Map();
      for (const { cell, hex } of keys) byCell.set(cell, [...(byCell.get(cell) ?? []), hex]);
      for (const [cell, hexes] of byCell) {
        check(await sb.from("sightings").delete().eq("cell", cell).in("hex", hexes), "deleting sightings");
      }
    },

    async insertRun(run) {
      check(await sb.from("runs").insert(run), "recording the run");
    },

    /** [{ at: ms, requests }] for runs since `sinceIso` that made requests. */
    async requestHistory(sinceIso) {
      const rows = check(
        await sb.from("runs").select("started_at, requests").gte("started_at", sinceIso).gt("requests", 0),
        "reading request history",
      );
      return rows.map((r) => ({ at: Date.parse(r.started_at), requests: r.requests }));
    },

    /** Runs older than `beforeIso` are only history; keep the table small. */
    async pruneRuns(beforeIso) {
      check(await sb.from("runs").delete().lt("started_at", beforeIso), "pruning old runs");
    },
  };
}
