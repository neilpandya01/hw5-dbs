# Sky Hunt

A plane-spotting game built on live flight data. A map shows the real planes flying near you; catch a commercial flight while its latest position is inside your 5-mile circle, and collect every airline and aircraft type. Planes over an airport's grey zone don't count. Rare aircraft, like a 747 or an A380, are worth more.

Built for Assignment 5 (Live Data System) of Design, Build, Ship: a worker that Supabase Cron runs every 30 seconds fetches live flight positions, saves only what changed to Supabase, and Supabase Realtime updates the page without a refresh.

## How it works

How data moves from the flight source to your screen (with the chart, the daily budget, and the freshness states) is in [docs/data-flow.md](docs/data-flow.md). The screens and their states are in [flows.md](flows.md). The code layout is in [AGENTS.md](AGENTS.md).

- **Next.js 16 and Tailwind CSS 4**, deployed on Vercel.
- **Clerk** for sign-in. Every page except `/sign-in` and `/sign-up` needs an account.
- **Supabase** for the database and Realtime: `hunters`, `sightings`, `runs`, `catches`, with row-level security. Catches are only made by a database function that checks the rules.
- **The worker** (`supabase/functions/worker/`, a Supabase Edge Function that Supabase Cron calls every 30 seconds): each run, for each grid cell with someone active in the last minute, it asks adsb.lol for the planes nearby and saves only what changed. It shares one budget of 500 requests a day across all players: under 75% used it fetches every 30 s, 75–90% every 60 s, and at 90% it pauses and the page says to come back later.
- **Flight data:** [adsb.lol](https://adsb.lol) (free, no key; © adsb.lol contributors, ODbL). Airline names: OpenFlights (ODbL). Airline logos: pics.avs.io. Airports: [OurAirports](https://ourairports.com/data/) (public domain).
- **Map:** Leaflet with Esri's grey Canvas map tiles (no key; © Esri, with OpenStreetMap data).
- **Location:** only coordinates rounded to about 1 km are ever saved. "Near Chicago, Illinois" comes from BigDataCloud's free reverse-geocoding endpoint.

## Setup

### 1. Supabase
1. In your Supabase project, open **SQL Editor**, paste all of [`supabase/migrations/20261028000000_sky_hunt_live_data.sql`](supabase/migrations/20261028000000_sky_hunt_live_data.sql), and run it. (Or apply it through the Supabase MCP.) The second migration, for the worker's schedule, comes in step 3.
2. Connect Clerk, in both dashboards:
   - **Clerk** (this app): **Integrations → Supabase → Activate**. This adds `role: authenticated` to Clerk's tokens; without it, Supabase treats everyone as signed out.
   - **Supabase**: **Authentication → Sign In / Providers → Third-party auth → Clerk**, with this Clerk app's domain (e.g. `https://your-app.clerk.accounts.dev`).
3. From **Project Settings → API Keys**, copy the **publishable** key (for the page). The worker gets the secret key from Supabase on its own; you never copy it anywhere.

### 2. The page
Create `.env.local` in the project folder (never commit it):

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

```bash
npm install
npm run dev
```

Open http://localhost:3000.

### 3. The worker, on Supabase
The worker is the Edge Function in [`supabase/functions/worker/`](supabase/functions/worker/). It runs only on Supabase (localhost uses it too, since it shares the database), so there is never more than one.

1. **Make a cron secret** (a random string that proves a call came from your Cron job):
   ```bash
   openssl rand -hex 32
   ```
2. **Give it to the function:** Supabase → **Edge Functions → Secrets → Add new secret**: `CRON_SECRET` = that string. (`SUPABASE_URL` and the secret key are already there.)
3. **Deploy the function**, with JWT checks off (it checks the cron secret instead). Either through the Supabase MCP (`deploy_edge_function`, name `worker`, `verify_jwt: false`, with every file under `supabase/functions/worker/` except `test/`), or with the CLI:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase functions deploy worker --no-verify-jwt
   ```
4. **Call it once by hand** and read the answer (one `runs` row as JSON; `"ok": true`):
   ```bash
   curl -X POST https://<project-ref>.supabase.co/functions/v1/worker -H "x-cron-secret: <the string>"
   ```
   With nobody on the Radar it says `"mode": "idle"`. Open the Radar page, wait 30 s, call again: `"mode": "normal"`, `"requests": 1`, and planes appear.
5. **Store the URL and secret in Vault** so Cron can call it (SQL Editor; these stay in your database, never in the repo):
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/worker', 'sky_hunt_worker_url');
   select vault.create_secret('<the string>', 'sky_hunt_cron_secret');
   ```
6. **Schedule it:** run [`supabase/migrations/20261029000000_worker_cron.sql`](supabase/migrations/20261029000000_worker_cron.sql) in the SQL Editor (or through the MCP). It turns on `pg_cron` and `pg_net` and calls the worker every 30 seconds.
7. **Check it:** **Integrations → Cron** shows `sky-hunt-worker` succeeding every 30 s; `select * from runs order by started_at desc limit 5;` shows a new row every 30 s; **Edge Functions → worker → Logs** shows one `[run]` line per call.

To stop the worker: `select cron.unschedule('sky-hunt-worker');` (re-run the migration to start it again).

### 4. The page, on Vercel
Import the repository on Vercel (Hobby plan), add the same variables as `.env.local`, and deploy. Never add the Supabase **secret** key to Vercel; only the worker has it, on Supabase.

### Free tiers
- **Supabase:** Cron calls the worker about 86,000 times a month (the free plan includes 500,000). Realtime only sends rows that changed. A free project pauses after a week unused, so open the app now and then until grades are back. Check **Organization → Usage**.
- **Vercel:** Hobby plan, no payment method. **Clerk:** free plan.
- **adsb.lol:** 500 requests a day for the whole app; the worker slows down and then pauses on its own.

## Troubleshooting

| You see | Cause | Fix |
|---|---|---|
| "Your account couldn't be loaded" with `permission denied for table hunters` | Supabase sees you as signed out | Turn on Clerk's Supabase integration and check the Clerk domain in Supabase (Setup step 1.2), then sign out and back in. Don't grant access to `anon`. |
| The location step says "We found you, but couldn't save it" | Same as above, or no connection | Same as above |
| "Flight data unavailable" | The worker isn't running (no run for 5 minutes), or its last run failed | Check **Integrations → Cron** (is `sky-hunt-worker` there and succeeding?), `select * from net._http_response order by created desc limit 5;` (a 401 means the Vault secret doesn't match `CRON_SECRET`), and the function's logs for `FAILED` lines |
| The worker keeps logging `mode=idle` | Nobody has the Radar page open | Open the Radar page; it checks in every 25 seconds |
| The worker's runs fail with `adsb.lol answered HTTP 403` | adsb.lol is refusing Supabase's servers | Check whether adsb.lol works from your own computer (`curl https://api.adsb.lol/v2/point/41.88/-87.63/5`); if it does, the block is on Supabase's network |
| "Sky Hunt has used today's flight data limit" | 90% of adsb.lol's 500 requests per rolling 24 hours are used | Wait (it frees up gradually over 24 hours). |
| The location step says location is blocked or unavailable | Browser permission, or the device's location is off | Follow the steps shown on the page |

While developing, the account banner also shows the technical reason (never on the live site).

## Tests

```bash
npm run test:worker
```

The worker's tests run it on a saved adsb.lol response ([`supabase/functions/worker/test/fixtures/chicago.json`](supabase/functions/worker/test/fixtures/chicago.json)) with an in-memory stand-in for Supabase. They check what it saves (44 planes in the air, the 9 on the ground skipped), that an unchanged response writes nothing, that only a plane that moved is saved again, that planes that leave are deleted, that every run is recorded, the budget modes (30 s, 60 s, paused), what happens when adsb.lol fails or refuses, and that runs which rebuild their state from the database each time (as each Cron call does) behave the same.
