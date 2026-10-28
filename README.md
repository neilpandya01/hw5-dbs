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
2. Make sure Clerk is connected: **Authentication → Sign In / Providers → Third-party auth → Clerk**, and the Supabase integration turned on in Clerk.
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

`npm run once` does a single run and prints one line. Then `npm run dev` keeps it running. With the page open on the radar, planes appear within about 30 seconds.

### 4. The worker, on Railway
1. Sign up at railway.com with GitHub (so the account is verified).
2. **New Project → Deploy from GitHub repo →** this repository.
3. In the service's **Settings**, set **Root Directory** to `worker`. The start command is `npm start`.
4. In **Variables**, add `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
5. Deploy, then check **Deployments → Logs** (or `railway logs`): one `[run]` line every 30 seconds.

### 5. The page, on Vercel
Import the repository on Vercel (Hobby plan), add the same variables as `.env.local`, and deploy.

## Tests

```bash
cd worker && npm test
```

The worker's tests run it on a saved adsb.lol response ([`worker/test/fixtures/chicago.json`](worker/test/fixtures/chicago.json)) with an in-memory stand-in for Supabase. They check what it saves (44 planes in the air, the 9 on the ground skipped), that an unchanged response writes nothing, that only a plane that moved is saved again, that planes that leave are deleted, that every run is recorded, the budget modes (30 s, 60 s, paused), and what happens when adsb.lol fails or refuses.
