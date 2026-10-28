<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Sky Hunt

A plane-spotting game. Real planes flying near you show up on a radar; catch them before they leave your 10-mile range and collect every airline and aircraft type. Flows are in `flows.md`; how data moves through the system is in `docs/data-flow.md`.

This is Assignment 5 (Live Data System) for Design, Build, Ship: a worker on Railway polls a live flight source, saves only what changed to Supabase, and Supabase Realtime pushes changes to the page.

## Stack and rules
- Next.js 16 + Tailwind CSS 4, Clerk for sign-in, Supabase for the database and Realtime, a small Node.js worker on Railway. The page deploys on Vercel.
- The worker lives in `worker/` with its own `package.json`. It's excluded in `tsconfig.json` and `eslint.config.mjs` so the Next.js build doesn't check it. Railway's root directory is `worker/`.
- Ask before adding npm packages beyond Clerk, Supabase, and Playwright.
- Keys live in `.env.local` (never committed, never read by the agent): `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and later `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Only publishable keys reach the browser. The Supabase **secret** key is only ever set in Railway's variables for the worker.
- Check with `npm run build` and `npm run lint` before committing. Pull first: the README is sometimes edited on GitHub.

## Data
**For now**, a person's data (onboarding done, rounded location, catches) is saved in this browser's localStorage, one entry per Clerk user ID, in `src/lib/store.ts`. Supabase isn't connected yet. Pages only call the store's functions, so moving to Supabase only changes that file (and `AccountSync`, which will hand Clerk's token to Supabase as in Assignment 4).

Planned tables (details in `docs/data-flow.md`): `spots`, `sightings`, `catches`, `runs`, `aircraft_types`, `airlines`, `routes`. `user_id` is the Clerk user ID (`auth.jwt()->>'sub'`), with row-level security on every table.

Location privacy: the exact position stays in the browser's memory. Only coordinates rounded to 2 decimals (about 1 km) are saved or sent anywhere, and the saved copy only updates after moving about 2 km, at most once a minute.

## Where things are
- `src/lib/store.ts`: the only data layer for a person's own data. `useStore()` is null until it loads.
- `src/lib/location.ts`: `locateOnce()` for onboarding; `useLiveLocation()` follows the position on the radar and saves the rounded copy when it changed enough; `problemMessage()` for blocked, timed-out, or unsupported location.
- `src/lib/geo.ts`: rounding, distances, offsets in miles, compass names, `CATCH_RANGE_MI` (10).
- `src/lib/rarity.ts`: tiers (common, uncommon, rare, legendary) and their points. `src/lib/collection.ts`: groups catches by airline and by aircraft type.
- `src/lib/nearestPlace.ts`: "Near Chicago, Illinois" from BigDataCloud's free reverse-geocoding endpoint, rounded coordinates only (from Assignment 4).
- `src/components/Radar.tsx`: the radar drawing (you, the catch ring, planes as buttons). Not a street map.
- `src/components/PlaneCard.tsx`: one plane's details and Catch. `FeedStatus.tsx`: how fresh the flight data is (only "not connected yet" for now).
- `src/proxy.ts`: Clerk middleware. Every route except `/sign-in` and `/sign-up` requires an account.
- `src/components/AccountSync.tsx` (in the layout): loads the signed-in person's data; clears it on sign-out. `OnboardingGate.tsx` sends new people to `/welcome`.
- Routes: `/` Radar, `/collection`, `/welcome` onboarding (`?step=overview|location|tutorial`), `/sign-in`, `/sign-up`.

## How it behaves
- **Onboarding is required**, and so is location. `/welcome` has three steps: overview, share location (no skip; blocked or failed location explains how to fix it, with Try again), and a practice catch on a radar centered on you (skippable). Reloading lands on the step reached, never past an unanswered one.
- **Radar** follows your position while open (stops when you leave the page), falls back to the saved location if finding you fails, and says so.
- **Live flights aren't connected yet.** The radar and list show empty states, and the feed status says "not connected yet". Next: loading, fresh, stale, and down states from the worker's `runs` table.

## Next.js gotchas here
- Cache Components is on: pages you leave are hidden (React `<Activity>`), not unmounted. Don't leave buttons stuck busy; reset transient UI in a `useLayoutEffect` cleanup.
- Any client component reading the URL (`usePathname`, `useParams`, `useSearchParams`) must be inside `<Suspense>`, or the build fails.

## Style
- Colors come from tokens in `src/app/globals.css` (light and dark). Rarity always shows its name, never color alone. Every control has a label; everything works by keyboard, including planes on the radar.
