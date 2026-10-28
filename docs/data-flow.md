# Sky Hunt: data flow

Sky Hunt is a plane-spotting game. A map shows the real planes flying near you; catch a commercial flight while its latest position is inside your 5-mile circle (and not over an airport) to add its airline and aircraft to your collection.

The first version of this chart was committed before any code (commit `0eb87b7`). This is the design as built.

## How data moves

```mermaid
flowchart TD
  SRC["adsb.lol<br/>free, no key, 500 requests/day"]
  W["Worker on Railway<br/>Node.js, always running"]
  DB["Supabase<br/>hunters · sightings · runs · catches"]
  PAGE["Next.js page on Vercel"]
  CLERK["Clerk sign-in"]

  PAGE -- "rounded location (when moved 2 km) + 'still here' every 25 s" --> DB
  DB -- "who's active in the last minute" --> W
  W -- "1 request per active grid cell, every 30 s" --> SRC
  SRC -- "every aircraft within 25 nm" --> W
  W -- "upsert planes that moved, delete planes that left, log the run" --> DB
  DB -- "Realtime: changed planes in my cell + each new run" --> PAGE
  CLERK --> PAGE
  PAGE -- "catch_plane(): the database checks the rules" --> DB
```

1. **Page → Supabase.** While the radar is open, it marks you active every 25 seconds (`touch_hunter()`), and saves your location rounded to about 1 km when you've moved about 2 km. Your exact position never leaves the browser.
2. **Supabase → worker.** Every run, the worker reads who was active in the last minute and groups them into **grid cells** (0.25°, about 17 × 13 miles in Chicago). Nobody active means no requests at all.
3. **Worker → adsb.lol.** One request per active cell (at most 4 per run, busiest first): every aircraft within 25 nautical miles of the cell's center, which covers the whole cell plus the 15 miles the page shows.
4. **Worker → Supabase.** Each aircraft becomes a `sightings` row: commercial, private, or unknown; airline and logo code; aircraft type and rarity; position, altitude, direction; whether it's over an airport's no-catch zone; and when it was pinged. Only planes that are new, moved a quarter mile, changed altitude by 300 ft, turned 10°, or haven't been saved for a minute are upserted. Planes that left are deleted. Each run adds a row to `runs`.
5. **Supabase → page.** Realtime pushes each changed plane in your cell, and each new run, to your open page. The page shows the closest planes and how fresh the data is.
6. **Catching.** `catch_plane()` checks the plane's latest ping: commercial, under 90 seconds old, within 5 miles of you (plus half a mile for rounding), not over an airport. Then it adds the catch. The page can't add catches itself.

## The shared daily budget

adsb.lol allows **500 requests per rolling 24 hours** (its `x-ratelimit-limit` header). One worker serves everyone, so the budget is app-wide:

| Used in the last 24 h | Worker | Page |
|---|---|---|
| Under 75% (375) | A run every 30 s | "Live · updated 12 s ago" |
| 75% to 90% | A run every 60 s | "Live · updated … · every minute today" |
| 90% or more (450) | No requests until enough age out | "Sky Hunt has used today's flight data limit. Come back later." with an estimated time |

A refused request (HTTP 429) also pauses requests for 5 minutes. The worker counts its own requests from `runs`, so a restart doesn't reset the count.

## Freshness states on the page

From the latest row in `runs`:

- **Loading:** before the first answer.
- **Fresh:** the last run worked within about 3 intervals. (Idle means nobody was active yet: "Looking for planes near you…")
- **Stale:** no successful run for 3 intervals: "Flight data is 2 min old"; old positions aren't catchable.
- **Down:** the last run failed, no run for 5 minutes (the worker isn't running), Supabase is unreachable, or the Realtime connection failed: "Flight data can't be displayed right now. Come back later."
- **Limit:** the budget pause above.

## Tables

| Table | Written by | Who can read | Realtime |
|---|---|---|---|
| `hunters` | Each person (own row) | Only the owner | No |
| `sightings` | Worker (secret key) | Signed-in people | Yes |
| `runs` | Worker | Signed-in people | Yes (inserts) |
| `catches` | `catch_plane()` only | Only the owner | No |

The full schema and row-level security policies are in `supabase/migrations/`.

## What's shown near you

- Out to 15 miles. At most 12 planes inside your 5-mile circle and 15 outside it, closest first.
- Each plane points the way it's flying, with a short dashed line ahead. Planes that can't be caught are faded.
- Opening a plane shows only its airline (with logo), aircraft type, and when it was last updated, plus Catch.
- Only commercial flights can be caught. Small planes, helicopters, and business jets are "Private plane"; anything without a callsign or type, military, or not recognized is "Unknown aircraft".
