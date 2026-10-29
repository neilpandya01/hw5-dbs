<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Sky Hunt

A plane-spotting game. Real planes flying near you show up on a map; catch them before they leave your 5-mile range (but not over an airport) and collect every airline and aircraft type. Flows are in `flows.md`; how data moves through the system is in `docs/data-flow.md`.

This is Assignment 5 (Live Data System) for Design, Build, Ship: a worker on Railway polls adsb.lol for planes near active players, saves only what changed to Supabase, and Supabase Realtime pushes changes to the page.

## Stack and rules
- Next.js 16 + Tailwind CSS 4, Clerk for sign-in, Supabase for the database and Realtime, a small Node.js worker on Railway. The page deploys on Vercel.
- The worker lives in `worker/` (plain JavaScript, its own `package.json`, no build step). It's excluded in `tsconfig.json` and `eslint.config.mjs` so the Next.js build doesn't check it. Railway's root directory is `worker/`.
- Ask before adding npm packages beyond Clerk, Supabase, Leaflet (the map), and Playwright.
- Keys (never committed, never read by the agent):
  - `.env.local` for the page: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Only publishable keys reach the browser.
  - `worker/.env` locally, Railway's variables in production: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`. The secret key skips row-level security; it never goes in the page or in code.
- Check with `npm run build`, `npm run lint`, and `cd worker && npm test` before committing.
- Running locally takes two terminals: `npm run dev` in the project folder (the page, localhost:3000) and `npm run dev` in `worker/` (the worker). Only ever run one worker at a time (local or Railway): two would spend the shared daily budget twice as fast.

## Data (Supabase)
How data moves, the daily budget, and the freshness states are in `docs/data-flow.md`. The schema, policies, and functions are in `supabase/migrations/`. `user_id` is the Clerk user ID (`auth.jwt()->>'sub'`).

- `hunters`: one row per person: `onboarded`, `lat`/`lon` rounded to 2 decimals (about 1 km), `location_at`, `last_active_at`. Own row only. `touch_hunter()` stamps `last_active_at` with the database's clock.
- `sightings`: written only by the worker; keyed by `(cell, hex)`. `kind` is `commercial` | `private` | `unknown`; airline (ICAO, IATA, name), type (code, name), rarity, position, altitude, `heading` (direction of travel), `airport` (the no-catch zone it's in, if any), `seen_at` (when it was pinged). Signed-in people can read. In Realtime.
- `runs`: one row per worker run: `ok`, `mode` (`normal` | `slow` | `paused` | `idle`), cells, requests, `requests_24h`, `daily_budget`, upserted, deleted, `rows_changed`, `resume_at`, `error`. Signed-in people can read. In Realtime (the page listens for inserts).
- `catches`: own rows only, and only created by `catch_plane(cell, hex, lat, lon)`, which also saves the caller's rounded location and marks them active, then checks at the plane's last ping: commercial, under 90 s old, within 5.5 miles of the rounded location, not in an airport zone, not already caught today (same aircraft once per UTC day). Errors are codes (`OUT_OF_RANGE`, `STALE`, …) that `RadarView` explains.

Location privacy: the exact position stays in the browser's memory. Only coordinates rounded to 2 decimals are saved or sent anywhere; the saved copy updates after moving about 2 km, at most once a minute.

## The worker (`worker/`)
- `src/index.js`: the loop. Loads the last 24 h of requests and the saved planes, then runs forever (`npm start`), or once (`npm run once`).
- `src/run.js`: one run: active hunters (last minute) → grid cells (`src/cells.js`, 0.25°; the page's `src/lib/cells.ts` must match) → mode from the budget → one request per cell (max 4, 300 ms apart) → `src/changes.js` decides what to write → upsert/delete → insert a `runs` row → log one line.
- `src/budget.js`: 500 requests per rolling 24 h, app-wide. Under 75%: every 30 s. 75–90%: every 60 s. 90%+: paused (with an estimated `resume_at`). A 429 pauses for 5 minutes.
- `src/classify.js`: commercial = airline-style callsign + an airline in `data/airlines.json` + an airliner type in `src/aircraft.js` (which also sets rarity). Tail-number callsigns and airline codes on non-airliners (NetJets) are private; no callsign/type, military, or unrecognized is unknown. Also marks planes in airport zones (`data/airports.json`).
- `data/airports.json` and `data/airlines.json` are generated by `scripts/build-airports.mjs` and `scripts/build-airlines.mjs` (sources and commands at the top of each).
- `test/`: `node --test` on a saved adsb.lol response (`test/fixtures/chicago.json`) and an in-memory stand-in for Supabase: what gets saved, only changes are rewritten, leavers are deleted, runs are recorded, budget modes, failures.

## Where things are (page)
- `src/lib/store.ts`: the only data layer for a person's own data (hunter row and catches). `useStore()` is null until it loads. Saves resolve false (and set `save-failed`) unless a row really changed. `catchPlane()` calls `catch_plane()`. Failed loads and saves keep a technical `problem`, logged to the console and shown in `StorageBanner` only in development.
- `src/lib/supabase.ts`: the one browser client; sends the Clerk session token (set by `AccountSync`), which Realtime uses too. Publishable key only. `describeToken()` reports only the token's `role` and issuer, for the permission-error message.
- If loading fails with `permission denied` (42501), Supabase saw the request as signed out: the Clerk app's Supabase integration must be on (it adds `role: authenticated`), and Supabase's third-party auth must list this Clerk app's domain. Never fix it by granting access to `anon`.
- `src/lib/flights.ts`: `useFlights(cell)`: loads the cell's planes and the latest run, then listens with Realtime (insert/update filtered to the cell; deletes checked by cell); reloads on resubscribe and on returning to the tab. `useNow()` ticks the clock.
- `src/lib/nearby.ts`: what to show (out to 15 mi; at most 12 inside the 5-mile circle and 15 outside, closest first; positions older than 2 min hidden), `catchBlock()` (why a plane can't be caught), `feedState()` (loading, fresh, stale, down, limit), names ("Private plane", "Unknown aircraft").
- `src/lib/heartbeat.ts`: while the radar is open and visible, `touch_hunter()` every 25 s.
- `src/lib/location.ts`: `locateOnce()` for onboarding (15 s timeout); `useLiveLocation()` follows the position and saves the rounded copy when it changed enough; `problemMessage()` and `DEVICE_LOCATION_HELP` explain blocked or unavailable location (`LocationHelp.tsx` shows them).
- `src/lib/geo.ts`: rounding, distances, offsets, compass names, `CATCH_RANGE_MI` (5). `src/lib/airports.ts`: airport zones from `public/airports.json` (3 mi large, 2 mi medium). `src/lib/rarity.ts`, `src/lib/collection.ts`: tiers and points, and the Collection's grouping (each group carries its catches and total points; rows expand to list them). `src/lib/nearestPlace.ts`: "Near Chicago, Illinois" (BigDataCloud).
- `src/components/FlightMap.tsx`: the live map (Leaflet, browser only). You, your 5-mile circle, airport zones (codes from zoom 10 in, full name on hover or tap), and planes rotated to their direction with a dashed line ahead; faded when they can't be caught. Plane markers are kept and updated in place (never rebuilt each render: the page re-renders every second, and rebuilding swallowed clicks). The open plane's card shows over the map (`panel`); a click on empty map calls `onMapClick`. Tiles: Esri's grey Canvas basemaps (no key). CARTO's tiles now require a key, and OpenStreetMap's own servers block apps that don't follow their policy, so don't switch to either.
- `src/components/PlaneCard.tsx`: only the airline (logo via `AirlineLogo.tsx`, from pics.avs.io by IATA code), aircraft type, and "Updated X ago", plus Catch or why not. `FeedStatus.tsx`: the freshness pill (loading, live, stale) and, instead of it, one banner when flight data is down or the daily limit is reached.
- `src/components/Radar.tsx`: the simple radar drawing, only for onboarding's practice catch.
- `src/proxy.ts`: Clerk middleware; every route except `/sign-in` and `/sign-up` needs an account. (Clerk warns that `createRouteMatcher` is deprecated; it still works.) `AccountSync.tsx` loads data and hands Clerk's token to Supabase. `OnboardingGate.tsx` sends new people to `/welcome`.
- Routes: `/` Radar, `/collection`, `/welcome` (`?step=overview|location|tutorial`), `/sign-in`, `/sign-up`.

## How it behaves
- **Onboarding is required**, and so is location: overview, share location (no skip; blocked or failed location explains how to fix it; a failed save says so instead of moving on), and a practice catch (skippable). The practice plane cruises at 24,000 ft, about 450 mph, and moves every 10 to 15 seconds like real data.
- **Radar** follows your position while open, marks you active, and shows live planes. Freshness is always visible; when flight data is down or the daily limit is reached, planes are hidden and a banner says to come back later.
- **Catching** needs a commercial flight whose latest ping (under 90 s old) was inside your 5-mile circle and not over an airport. Private and unknown planes show but can't be caught.

## Next.js gotchas here
- Cache Components is on: pages you leave are hidden (React `<Activity>`), not unmounted. Don't leave buttons stuck busy; reset transient UI in a `useLayoutEffect` cleanup.
- Any client component reading the URL (`usePathname`, `useParams`, `useSearchParams`) must be inside `<Suspense>`, or the build fails.

## Style
- Colors come from tokens in `src/app/globals.css` (light and dark). Rarity always shows its name, never color alone. Every control has a label; everything works by keyboard, including planes on the radar.
