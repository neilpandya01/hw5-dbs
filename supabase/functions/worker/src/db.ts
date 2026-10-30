import { createClient } from "npm:@supabase/supabase-js@2.118.0";

// Everything the worker reads and writes in Supabase. It uses the SECRET key, which skips row-level
// security. Supabase hands that key to the Edge Function on its own servers; it's never in code.

const SIGHTING_COLUMNS =
  "cell, hex, callsign, kind, airline_icao, airline_iata, airline_name, type_code, type_name, rarity, lat, lon, alt_ft, speed_kt, heading, airport, seen_at";

type Row = Record<string, unknown>;
type Key = { cell: string; hex: string };

function check<T>({ data, error }: { data: T; error: { message: string } | null }, what: string): T {
  if (error) throw new Error(`Supabase, ${what}: ${error.message}`);
  return data;
}

export function createDb(url: string, secretKey: string) {
  const sb = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

  return {
    /** Rounded locations of everyone active since `sinceIso`. */
    async activeHunters(sinceIso: string) {
      const rows = check(
        await sb.from("hunters").select("lat, lon").gte("last_active_at", sinceIso).not("lat", "is", null).not("lon", "is", null),
        "reading active hunters",
      ) ?? [];
      return rows.map((r) => ({ lat: Number(r.lat), lon: Number(r.lon) }));
    },

    /** Every saved plane. Each run starts fresh, so this is how it knows what's already there. */
    async loadSightings() {
      return check(await sb.from("sightings").select(SIGHTING_COLUMNS), "loading sightings") ?? [];
    },

    async upsertSightings(rows: Row[]) {
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500).map((r) => ({ ...r, updated_at: new Date().toISOString() }));
        check(await sb.from("sightings").upsert(batch, { onConflict: "cell,hex" }), "saving sightings");
      }
    },

    async deleteSightings(keys: Key[]) {
      const byCell = new Map<string, string[]>();
      for (const { cell, hex } of keys) byCell.set(cell, [...(byCell.get(cell) ?? []), hex]);
      for (const [cell, hexes] of byCell) {
        check(await sb.from("sightings").delete().eq("cell", cell).in("hex", hexes), "deleting sightings");
      }
    },

    async insertRun(run: Row) {
      check(await sb.from("runs").insert(run), "recording the run");
    },

    /** [{ at: ms, requests }] for runs since `sinceIso` that made requests. */
    async requestHistory(sinceIso: string) {
      const rows = check(
        await sb.from("runs").select("started_at, requests").gte("started_at", sinceIso).gt("requests", 0),
        "reading request history",
      ) ?? [];
      return rows.map((r) => ({ at: Date.parse(r.started_at), requests: r.requests }));
    },

    /** When `source` last refused a request (HTTP 429) since `sinceIso`, in ms, or null. */
    async lastRateLimitedAt(source: string, sinceIso: string) {
      const rows = check(
        await sb
          .from("runs")
          .select("started_at")
          .gte("started_at", sinceIso)
          .like("error", `%${source} refused%`)
          .order("started_at", { ascending: false })
          .limit(1),
        "reading the last rate limit",
      ) ?? [];
      return rows.length ? Date.parse(rows[0].started_at) : null;
    },
  };
}
