# Sky Hunt: data flow

How data moves from the flight source to a player's screen. The daily limits mentioned here are explained in [usage-limits.md](usage-limits.md); what players see is in [flows.md](../flows.md).

The first version of this chart was committed before any code (commit `0eb87b7`). This is the design as built, after three changes:

1. The worker first ran on Railway. When Railway stopped taking new signups, it moved to a Supabase Edge Function that Supabase Cron calls, so the whole system is Vercel, Supabase, and Clerk.
2. adsb.lol often refused requests from Supabase's shared IP addresses, so adsb.fi (same format) became the main source and adsb.lol the backup.
3. Updates went from every 30 seconds to every 2 seconds. To keep that on the free plan, each zone's changes are bundled into one Realtime message, and the app limits itself per day.

## The chart

```mermaid
flowchart TD
  SRC["adsb.fi (adsb.lol as backup)<br/>free, no key"]
  CRON["Supabase Cron<br/>every 30 s"]
  W["Worker: Supabase Edge Function<br/>each call runs about 20 s"]
  DB["Supabase<br/>hunters · sightings · frames · runs · catches"]
  PAGE["Next.js page on Vercel"]
  CLERK["Clerk sign-in"]

  PAGE -- "rounded location (when moved 2 km)<br/>+ 'still here' every 25 s (counts today's Radar time)" --> DB
  CRON -- "POST with x-cron-secret" --> W
  DB -- "who's active, saved planes, last 24 h of usage" --> W
  W -- "fast: one zone every 2 s (taking turns)<br/>or every 30 s, up to 4 zones" --> SRC
  SRC -- "every aircraft within 25 nm" --> W
  W -- "planes that changed (sightings) + one bundle per zone update (frames)<br/>+ one runs row per call, with its usage estimate" --> DB
  DB -- "Realtime: my zone's bundles + each new run" --> PAGE
  PAGE -- "on open, reconnect, or return: load my zone's planes + latest run" --> DB
  CLERK --> PAGE
  PAGE -- "catch_plane(): the database checks the rules" --> DB
```

## Step by step

1. **Page → Supabase.** While the Radar is open and in front, it calls `touch_hunter()` every 25 seconds, which marks you active and counts today's Radar time. When you've moved about 2 km, it saves your location rounded to about 1 km. Your exact position never leaves the browser.
2. **Cron → worker.** Every 30 seconds, Supabase Cron calls the worker with the cron secret. A call remembers nothing from the last one, so it first reads what earlier calls left: the saved planes, and the last 24 hours of usage summed by `worker_usage()`. Then it reads who checked in during the last minute (and how long each has played today), and groups them into **zones**: grid cells of 0.25°, about 17 × 13 miles in Chicago, busiest first. Planes in zones nobody's in anymore are deleted. With nobody active, the call makes no requests (`idle`).
3. **Worker → flight source.** A call lasts about 20 seconds.
   - **Fast** (normally): at 0, 2, 4 … 20 seconds, it asks adsb.fi for the next zone in turn. One zone is updated every 2 s, two zones every 4 s each, up to 8 zones. A zone where everyone watching has played 2 hours today gets one turn per call instead (every 30 s), between the fast turns.
   - **30-second pass**: one request per zone (up to 4), 1.1 s apart, adsb.fi first and adsb.lol if adsb.fi fails. It's used when a daily limit says so, or when adsb.fi is refusing. If adsb.fi stops answering partway through a fast call, the rest of that call is a pass.
   - Each request returns every aircraft within 25 nautical miles of the zone's center: the whole zone plus the 15 miles the page shows.
4. **Worker → Supabase.** Each aircraft becomes a `sightings` row: commercial, private, or unknown; airline, aircraft type, and rarity; position, altitude, and direction; whether it's over an airport's no-catch zone; and when it was pinged. Only planes that are new, moved a quarter mile, changed altitude by 300 ft, turned 10°, or weren't saved for a minute are written, and planes missing from the answer are deleted. If anything changed, the same changes go into the zone's one **`frames`** row (changed planes, and the ones that left), so Realtime sends **one message per update** instead of one per plane. Each call ends by adding a row to **`runs`**: what it did, and its estimate of the messages and bytes it caused.
5. **Supabase → page.** Realtime pushes each update of your zone and each new run to your open Radar. The page applies the bundle to the planes it has and shows the closest ones. When it opens, reconnects, or you return to the tab, it loads your zone's planes and the latest run directly. A tab hidden for a minute closes its live connection.
6. **Catching.** `catch_plane()` checks the plane's latest ping in `sightings`: commercial, under 90 seconds old, within 5 miles of you (plus half a mile for rounding), and not over an airport. Then it adds the catch. The page can't add catches itself.

## Freshness

The page decides how fresh the data is from the latest `runs` row, your zone's latest bundle, and its own live connection (`feedState()` in `src/lib/nearby.ts`). It checks these in order, so exactly one applies:

| State | When |
|---|---|
| Loading | Nothing has loaded yet |
| Down | Supabase can't be reached, the live connection has been lost for over 45 s, or no run for 5 minutes (the worker isn't running) |
| Limit | The latest run is `paused`: updates are stopped for everyone by a daily limit, or every source is refusing |
| Down | The latest run failed: a zone it asked about got no answer from either source |
| Connecting | The live connection is starting or reconnecting (under 45 s) |
| Starting | The latest run was `idle`: you just arrived and the worker hasn't seen you yet |
| Stale | No run for 3 intervals plus 15 s (105 s; 195 s in slow mode). Positions over 2 minutes old are hidden and can't be caught |
| Fresh | Otherwise. "Updated" is the newer of your zone's latest bundle and the latest run; the pace (every 2 s, 30 s, or 60 s) comes from your zone's latest bundle |

The page reconnects 3 seconds after its live connection drops, and if it hears nothing for 75 seconds it reloads and reconnects. The wording of each state is in [flows.md](../flows.md).

## Tables

| Table | Written by | Who can read | Realtime |
|---|---|---|---|
| `hunters` | Each person, own row: only `onboarded`, `lat`, `lon`, `location_at`. Activity and Radar time only through `touch_hunter()` and `catch_plane()` | Only the owner | No |
| `sightings` | Worker (secret key, on Supabase's servers) | Signed-in people | No: the page loads it, and catching checks it |
| `frames` | Worker: one row per zone, overwritten on each update with changes | Signed-in people | Yes: one message per zone update, filtered to your zone |
| `runs` | Worker: one row per call, kept 7 days | Signed-in people | Yes: each insert, to every open Radar |
| `catches` | `catch_plane()` only | Only the owner | No |

The full schema and row-level security policies are in [`supabase/migrations/`](../supabase/migrations/).
