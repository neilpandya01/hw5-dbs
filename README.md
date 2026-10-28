# Sky Hunt

A plane-spotting game built on live flight data. A map shows the real planes flying near you; catch a commercial flight while its latest position is inside your 5-mile circle, and collect every airline and aircraft type. Planes over an airport's grey zone don't count. Rare aircraft, like a 747 or an A380, are worth more.

Built for Assignment 5 (Live Data System) of Design, Build, Ship: a worker that runs all the time fetches live flight positions, saves only what changed to Supabase, and Supabase Realtime updates the page without a refresh.

## How it works

How data moves from the flight source to your screen (with the chart, the daily budget, and the freshness states) is in [docs/data-flow.md](docs/data-flow.md). The screens and their states are in [flows.md](flows.md). The code layout is in [AGENTS.md](AGENTS.md).

- **Next.js 16 and Tailwind CSS 4**, deployed on Vercel.
- **Clerk** for sign-in. Every page except `/sign-in` and `/sign-up` needs an account.
- **Supabase** for the database and Realtime: `hunters`, `sightings`, `runs`, `catches`, with row-level security. Catches are only made by a database function that checks the rules.
- **The worker** (`worker/`, Node.js on Railway): every 30 seconds, for each grid cell with someone active in the last minute, it asks adsb.lol for the planes nearby and saves only what changed. It shares one budget of 500 requests a day across all players: under 75% used it runs every 30 s, 75–90% every 60 s, and at 90% it pauses and the page says to come back later.
- **Flight data:** [adsb.lol](https://adsb.lol) (free, no key; © adsb.lol contributors, ODbL). Airline names: OpenFlights (ODbL). Airline logos: pics.avs.io. Airports: [OurAirports](https://ourairports.com/data/) (public domain).
- **Map:** Leaflet with Esri's grey Canvas map tiles (no key; © Esri, with OpenStreetMap data).
- **Location:** only coordinates rounded to about 1 km are ever saved. "Near Chicago, Illinois" comes from BigDataCloud's free reverse-geocoding endpoint.

## Setup

### 1. Supabase
1. In your Supabase project, open **SQL Editor**, paste all of [`supabase/migrations/20261028000000_sky_hunt_live_data.sql`](supabase/migrations/20261028000000_sky_hunt_live_data.sql), and run it. (Or apply it through the Supabase MCP.)
2. Connect Clerk, in both dashboards:
   - **Clerk** (this app): **Integrations → Supabase → Activate**. This adds `role: authenticated` to Clerk's tokens; without it, Supabase treats everyone as signed out.
   - **Supabase**: **Authentication → Sign In / Providers → Third-party auth → Clerk**, with this Clerk app's domain (e.g. `https://your-app.clerk.accounts.dev`).
3. From **Project Settings → API Keys**, copy the **publishable** key (for the page) and a **secret** key (for the worker only).

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

### 3. The worker, on your computer first
Create `worker/.env` (never commit it):

```
SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

```bash
cd worker
npm install
npm test
npm run once
```

`npm run once` does a single run and prints one line. Then `npm run dev` keeps it running.

Locally you need **two terminals**: `npm run dev` in the project folder (the page) and `npm run dev` in `worker/` (the worker). With the page open on the Radar, the worker's lines switch from `mode=idle` to `mode=normal` and planes appear within about 30 seconds.

### 4. The worker, on Railway
1. Sign up at railway.com with GitHub (so the account is verified; unverified accounts may not reach adsb.lol).
2. Install the CLI and log in: `npm install -g @railway/cli`, then `railway login`.
3. **New Project → Deploy from GitHub repo →** this repository.
4. In the service's **Settings**, set **Root Directory** to `worker`. The start command is `npm start`.
5. In **Variables**, add `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
6. Deploy, then check the logs (`railway logs`, or **Deployments → Logs**): one `[run]` line every 30 seconds.
7. Stop your local worker. Only one worker should run at a time, or the shared daily budget is spent twice as fast.

### 5. The page, on Vercel
Import the repository on Vercel (Hobby plan), add the same variables as `.env.local`, and deploy. Never add the Supabase **secret** key to Vercel; it belongs only to the worker.

## Troubleshooting

| You see | Cause | Fix |
|---|---|---|
| "Your account couldn't be loaded" with `permission denied for table hunters` | Supabase sees you as signed out | Turn on Clerk's Supabase integration and check the Clerk domain in Supabase (Setup step 1.2), then sign out and back in. Don't grant access to `anon`. |
| The location step says "We found you, but couldn't save it" | Same as above, or no connection | Same as above |
| "Flight data unavailable" | The worker isn't running (no run for 5 minutes), or its last run failed | Start the worker (or check Railway's logs for `FAILED` lines) |
| The worker keeps logging `mode=idle` | Nobody has the Radar page open | Open the Radar page; it checks in every 25 seconds |
| "Sky Hunt has used today's flight data limit" | 90% of adsb.lol's 500 requests per rolling 24 hours are used | Wait; the page shows about when updates return. Make sure only one worker is running. |
| The location step says location is blocked or unavailable | Browser permission, or the device's location is off | Follow the steps shown on the page |

While developing, the account banner also shows the technical reason (never on the live site).

## Tests

```bash
cd worker && npm test
```

The worker's tests run it on a saved adsb.lol response ([`worker/test/fixtures/chicago.json`](worker/test/fixtures/chicago.json)) with an in-memory stand-in for Supabase. They check what it saves (44 planes in the air, the 9 on the ground skipped), that an unchanged response writes nothing, that only a plane that moved is saved again, that planes that leave are deleted, that every run is recorded, the budget modes (30 s, 60 s, paused), and what happens when adsb.lol fails or refuses.
