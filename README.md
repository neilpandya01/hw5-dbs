# Sky Hunt

A plane-spotting game on live flight data. A map shows the real planes flying near you; catch a commercial flight while it's inside your 5-mile circle, and collect every airline and aircraft type. Rare aircraft, like a 747 or an A380, are worth more.

**Play:** https://hw5-dbs.vercel.app

Built for Assignment 5 (Live Data System) of Design, Build, Ship (MPCS 51238).

## How to play

1. Sign up, and share your location (it's rounded to about 1 km before it's saved).
2. Try the practice catch, then open the **Radar**: planes within 15 miles, moving every few seconds.
3. Press a plane, or **Catch** on its row in "In your circle". It needs to be a commercial flight inside your circle and not over an airport's grey zone.
4. See everything you've caught in **Collection**, by airline and by aircraft.

## How it works

A worker on Supabase fetches live flight positions every 2 seconds, saves only what changed, and Supabase Realtime updates the page without a refresh. Everything runs on free plans: Next.js and Tailwind on Vercel, Clerk for sign-in, Supabase for the database, Realtime, and the worker.

| To learn about | Read |
|---|---|
| How data moves from the flight source to your screen (the chart) | [docs/data-flow.md](docs/data-flow.md) |
| The daily limits that keep it free, and why | [docs/usage-limits.md](docs/usage-limits.md) |
| Every screen, state, and message | [flows.md](flows.md) |
| The code, setup, and deploying | [AGENTS.md](AGENTS.md) |

## Run it locally

```bash
npm install
npm run dev
```

It needs a `.env.local` (see [AGENTS.md](AGENTS.md)) and uses the deployed worker, so there's nothing else to run. The worker's tests:

```bash
npm run test:worker
```

## Credits

Flight data from [adsb.fi](https://adsb.fi) and [adsb.lol](https://adsb.lol) (ODbL). Airline names: OpenFlights (ODbL). Airline logos: pics.avs.io. Airports: [OurAirports](https://ourairports.com/data/) (public domain). Map tiles: Esri (with OpenStreetMap data). Place names: BigDataCloud.
