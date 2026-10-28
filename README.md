# Sky Hunt

A plane-spotting game built on live flight data. A map shows the real planes flying near you; catch one before it leaves your 5-mile range, and collect every airline and aircraft type. Planes over an airport's grey zone don't count. Rare aircraft, like a 747 or an A380, are worth more.

Built for Assignment 5 (Live Data System) of Design, Build, Ship: a worker that runs all the time fetches live flight positions, saves only what changed to Supabase, and Supabase Realtime updates the page without a refresh.

## Status

- ✅ Sign-in with Clerk, required onboarding (how it works → share location → practice catch), a zoomable map centered on you with your catch range and airport no-catch zones, Collection with Airlines and Aircraft tabs.
- ⏳ Next: Supabase tables and row-level security, the flight worker on Railway, live planes on the radar, catching real planes, and fresh / stale / down states.

For now, onboarding and catches are saved in your browser; they'll move to Supabase.

## How it works

How data moves from the flight source to your screen is in [docs/data-flow.md](docs/data-flow.md). The screens and their states are in [flows.md](flows.md). The code layout is in [AGENTS.md](AGENTS.md).

- **Next.js 16 and Tailwind CSS 4**, deployed on Vercel.
- **Clerk** for sign-in. Every page except `/sign-in` and `/sign-up` needs an account (`src/proxy.ts`).
- **Supabase** for the database and Realtime (coming next).
- **Railway** for the worker, a small Node.js program in `worker/` (coming next).
- **Map:** Leaflet with CARTO's map tiles (© OpenStreetMap contributors, © CARTO).
- **Airports:** from [OurAirports](https://ourairports.com/data/) (public domain), built into `public/airports.json` by `scripts/build-airports.mjs`.
- **Location:** only coordinates rounded to about 1 km are ever saved. "Near Chicago, Illinois" comes from BigDataCloud's free reverse-geocoding endpoint.

## Running it locally

Create `.env.local` with your own keys (never commit it):

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

Then:

```bash
npm install
npm run dev
```

Open http://localhost:3000. The browser asks for your location during onboarding; Sky Hunt needs it to work.
