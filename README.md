# Sky Hunt

A plane-spotting game built on live flight data. A map shows the real planes flying near you; catch a commercial flight while its latest position is inside your 5-mile circle, and collect every airline and aircraft type. Planes over an airport's grey zone don't count. Rare aircraft, like a 747 or an A380, are worth more.

Built for Assignment 5 (Live Data System) of Design, Build, Ship: a worker that Supabase Cron calls every 30 seconds fetches live flight positions every 2 seconds while it runs, saves only what changed to Supabase, and Supabase Realtime updates the page without a refresh. It all fits in free plans, with daily limits explained in [docs/usage-limits.md](docs/usage-limits.md).

## How it works

How data moves from the flight source to your screen (with the chart and the freshness states) is in [docs/data-flow.md](docs/data-flow.md); every daily limit and why it exists is in [docs/usage-limits.md](docs/usage-limits.md). The screens and their states are in [flows.md](flows.md). The code layout is in [AGENTS.md](AGENTS.md).

- **Next.js 16 and Tailwind CSS 4**, deployed on Vercel.
- **Clerk** for sign-in. Every page except `/sign-in` and `/sign-up` needs an account.
- **Supabase** for the database and Realtime: `hunters`, `sightings`, `frames` (one bundle per zone update), `runs`, `catches`, with row-level security. Catches are only made by a database function that checks the rules.
- **The worker** (`supabase/functions/worker/`, a Supabase Edge Function that Supabase Cron calls every 30 seconds): each call runs about 20 seconds and, every 2 seconds, fetches the next zone (grid cell) with someone active from adsb.fi, saves only the planes that changed, and writes them as one bundle so Realtime sends one message per update. With one zone, it's updated every 2 s; with two, each every 4 s. When the day's fast allowance is used, or adsb.fi refuses, it goes back to one pass every 30 s over up to 4 zones, with adsb.lol as the fallback source (within its own 500-a-day budget).
- **Daily limits** ([docs/usage-limits.md](docs/usage-limits.md)): the app keeps each day to a thirtieth of Supabase's free monthly Realtime messages and egress (fast updates under 50% of that, 30-second updates to 90%, paused beyond), and each person gets 2 hours of 2-second updates a day, then 30-second updates (they keep playing).
- **Flight data:** [adsb.fi](https://adsb.fi) (free, no key, personal non-commercial use, credited on the Radar), with [adsb.lol](https://adsb.lol) as the fallback (free, no key; © adsb.lol contributors, ODbL). Same format. Airline names: OpenFlights (ODbL). Airline logos: pics.avs.io. Airports: [OurAirports](https://ourairports.com/data/) (public domain).
- **Map:** Leaflet with Esri's grey Canvas map tiles (no key; © Esri, with OpenStreetMap data).
- **Location:** only coordinates rounded to about 1 km are ever saved. "Near Chicago, Illinois" comes from BigDataCloud's free reverse-geocoding endpoint.

## Setup

### 1. Supabase
1. In your Supabase project, open **SQL Editor**, paste all of [`supabase/migrations/20261028000000_sky_hunt_live_data.sql`](supabase/migrations/20261028000000_sky_hunt_live_data.sql), and run it. (Or apply it through the Supabase MCP.) The other migrations come in step 3, after the worker is deployed.
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
   npx supabase functions deploy worker --no-verify-jwt --use-api
   ```
   (`--use-api` bundles on Supabase's side, so Docker isn't needed.)
4. **Call it once by hand**, before scheduling it, and read the answer (one `runs` row as JSON; `"ok": true`):
   ```bash
   curl -X POST https://<project-ref>.supabase.co/functions/v1/worker -H "x-cron-secret: <the string>"
   ```
   With nobody on the Radar it says `"mode": "idle"`. This needs the last migration (step 6) for `worker_usage()`; without it, the call is recorded as failed. Open the Radar page, then call again: it takes about 20 seconds and says `"mode": "fast"`, `"ticks": 11`, and planes appear. Don't call it by hand once Cron is running: two calls at once would ask adsb.fi twice as often.
5. **Store the URL and secret in Vault** so Cron can call it (SQL Editor; these stay in your database, never in the repo):
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/worker', 'sky_hunt_worker_url');
   select vault.create_secret('<the string>', 'sky_hunt_cron_secret');
   ```
6. **Run the remaining migrations, in order** (SQL Editor or the MCP):
   - [`20261029000000_worker_cron.sql`](supabase/migrations/20261029000000_worker_cron.sql): turns on `pg_cron` and `pg_net` and calls the worker every 30 seconds (plus hourly cleanup of old runs).
   - [`20261030000000_runs_source.sql`](supabase/migrations/20261030000000_runs_source.sql): records which source answered.
   - [`20261030010000_fast_updates_and_limits.sql`](supabase/migrations/20261030010000_fast_updates_and_limits.sql): `frames` (bundles, in Realtime instead of `sightings`), the usage columns and `worker_usage()`, daily Radar time, and a 29-second timeout for each call.
   - [`20261030020000_soft_play_limit.sql`](supabase/migrations/20261030020000_soft_play_limit.sql): past 2 hours, slower updates instead of a stop; catching always allowed; `frames.pace`.
7. **Check it:** **Integrations → Cron** shows `sky-hunt-worker` succeeding every 30 s; `select * from runs order by started_at desc limit 5;` shows a new row every 30 s; **Edge Functions → worker → Logs** shows one `[run]` line per call.

To stop the worker: `select cron.unschedule('sky-hunt-worker');` (re-run the migration to start it again).

### 4. The page, on Vercel
Import the repository on Vercel (Hobby plan), add the same variables as `.env.local`, and deploy. Never add the Supabase **secret** key to Vercel; only the worker has it, on Supabase.

### Free tiers
Sky Hunt limits itself to stay inside the free plans every day; the numbers and the reasoning are in [docs/usage-limits.md](docs/usage-limits.md). To see where today stands:

```sql
select started_at, mode, ticks, fi_requests_24h, requests_24h as lol_requests_24h,
       messages_24h, round(bytes_24h / 1e6, 1) as mb_24h
from runs order by started_at desc limit 1;
```

- **Supabase:** Cron calls the worker 86,400 times a month (500,000 free). Realtime messages (2 million a month) and egress (5 GB) are what fast updates use; the worker keeps each day to a thirtieth of them. A free project pauses after a week unused, so open the app now and then until grades are back. Check **Organization → Usage**.
- **Vercel:** Hobby plan, no payment method. **Clerk:** free plan.
- **adsb.fi:** 1 request per second (we use at most one every 2 s, and 12,000 a day). **adsb.lol:** our own 500 a day, as the fallback.

## Troubleshooting

| You see | Cause | Fix |
|---|---|---|
| "Your account couldn't be loaded" with `permission denied for table hunters` | Supabase sees you as signed out | Turn on Clerk's Supabase integration and check the Clerk domain in Supabase (Setup step 1.2), then sign out and back in. Don't grant access to `anon`. |
| The location step says "We found you, but couldn't save it" | Same as above, or no connection | Same as above |
| "Flight data can't be displayed right now" | The worker isn't running (no run for 5 minutes), its last run failed, or the live connection was lost for over 45 seconds | Check **Integrations → Cron** (is `sky-hunt-worker` there and succeeding?), `select * from net._http_response order by created desc limit 5;` (a 401 means the Vault secret doesn't match `CRON_SECRET`), and the function's logs for `FAILED` lines |
| The worker keeps logging `mode=idle` | Nobody has the Radar page open | Open the Radar page; it checks in every 25 seconds |
| `runs.error` says `adsb.fi refused the request … (HTTP 429)` but `ok` is true and `source` is `adsb.lol` | Both sources limit per IP, and Supabase's Edge Functions share IPs with other projects | Nothing: the fallback answered, and adsb.fi is tried again after 5 minutes |
| "Sky Hunt has reached today's flight data limit" (runs are `paused`) | `messages_24h` or `bytes_24h` reached 90% of a day's share; or both sources refused (HTTP 429) in the last 5 minutes; or adsb.fi is unavailable and adsb.lol's 500-a-day budget is 90% used | Wait; it resumes on its own (`resume_at` when known). See [docs/usage-limits.md](docs/usage-limits.md) |
| "updating every 30 s right now" | The day's fast allowance (50% of a day's share) is used, or adsb.fi refused in the last 5 minutes or reached 12,000 requests today | Nothing; it goes back to every 2 s on its own |
| "2 h played today, slower updates" | You've had the Radar open for 2 hours today, and nobody else in your zone is under 2 hours | Nothing; it's the per-person limit (updates every 30 s). It resets at midnight UTC |
| The location step says location is blocked or unavailable | Browser permission, or the device's location is off | Follow the steps shown on the page |

While developing, the account banner also shows the technical reason (never on the live site).

## Tests

```bash
npm run test:worker
```

The worker's tests run it on a saved response ([`supabase/functions/worker/test/fixtures/chicago.json`](supabase/functions/worker/test/fixtures/chicago.json)) with an in-memory stand-in for Supabase and a fake clock. They check fast updates (one zone every 2 s, zones taking turns), that only changed planes are saved and bundled into one update, that planes that leave are removed, the usage estimate (one message per person watching), the daily limits (30-second updates past 50%, paused past 90%), the 4-zone pass, adsb.fi failing over to adsb.lol, adsb.lol's budget (slow, paused), both sources refusing, calls that rebuild their state from the database (as each Cron call does), and both sources' response formats.
