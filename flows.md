# Flows

Sky Hunt's flows: the first visit (signing up and onboarding), the main flow, and the collection.

## First visit

> **I open Sky Hunt → I sign up → I read how the game works → I share my location → I practice catching a plane on a radar around me → I land on my radar.**

```mermaid
flowchart TD
  A([Open Sky Hunt]) --> S{Signed in?}
  S -- No --> SI["/sign-in (or /sign-up), with Clerk"]
  SI --> B{Finished onboarding?}
  S -- Yes --> B
  B -- Yes --> R[Radar]
  B -- No --> W0["/welcome step 1 of 3: how the game works"]
  W0 -- Get started --> W1["Step 2 of 3: Where are you hunting from?"]
  W1 -- Back --> W0
  W1 -- "Share my location: browser allows" --> L[(Saved: location, rounded to ~1 km)]
  W1 -- "Blocked, unavailable, or no answer in 15 s" --> WE["What went wrong + how to fix it"]
  WE -- Try again --> W1
  L --> W2["Step 3 of 3: practice catch on a radar around me"]
  W2 -- Back --> W1
  W2 -- "Next → tap the practice plane → Catch (in range, not over an airport)" --> C["Caught!"]
  C -- Start hunting --> R
  W2 -- Skip practice --> R
```

- Every page except `/sign-in` and `/sign-up` needs an account. Signing out is in the account menu (top right).
- Location is required: there's no skip. If the browser blocks it, the step says how to allow it (the icon left of the address bar → Location → Allow), with Try again.
- Each step has its own URL (`/welcome?step=overview|location|tutorial`), so Back goes to the previous step. Reloading lands on the step you'd reached, never past an unanswered one.
- The practice plane is made up and its catch isn't saved. Like real flight data, its position jumps every 10 to 15 seconds (it cruises at 24,000 ft, about 450 mph), so it's catchable for about 80 seconds per pass. Grey airport zones near you show on the practice radar too.
- If your account can't be loaded, a banner says so at the top (while developing, with the technical reason). If the browser finds you but the save fails, the step says "We found you, but couldn't save it to your account." and stays put; finishing onboarding works the same way.

## Main flow

> **I open Sky Hunt → a map is centered on where I am, with my 5-mile catch circle in blue and airports in grey → within about 30 seconds, real planes near me appear, pointing the way they're flying and moving every few seconds → I open one: its airline and logo, aircraft type, and when it was last updated → if it's a commercial flight whose latest ping was inside my circle (and not over an airport), I catch it → it's in my collection.**

```mermaid
flowchart TD
  A([Open Sky Hunt]) --> R["Map centered on me: 5-mile circle, grey airport zones"]
  R -->|location blocked or failing| P["Explains + Try again; uses my last saved location"]
  R --> F{Flight data?}
  F -- "Loading" --> L["Loading flights…"]
  F -- "Connecting / starting" --> K["'Connecting to live updates…' or 'Looking for planes near you…'"]
  F -- "Fresh (a run in the last ~3 intervals)" --> M["Planes on the map and in two lists: in my circle, nearby"]
  F -- "My 2 hours of Radar used today" --> T["'You've used today's 2 hours of Radar' + when it's back; collection still open"]
  F -- "Stale (a few missed updates)" --> S["'No update for 2 min' (worded for whether planes are still shown); old pings can't be caught"]
  F -- "Down" --> D["'Flight data can't be displayed right now. Come back later.'"]
  F -- "Daily limit reached (app-wide)" --> X["'Sky Hunt has reached today's flight data limit. Come back later.'"]
  M --> O["Open a plane: airline + logo, aircraft type, updated X s ago"]
  M --> Q["Or press Catch on its row in 'In your circle'"]
  Q --> C
  O -->|commercial, latest ping in my circle, fresh, not over an airport| C["Catch → 'Caught!' → in my collection"]
  O -->|otherwise| W["Says why: private/unknown, outside my circle, over an airport, ping too old, caught today"]
```

**What's shown**
- Planes out to 15 miles: at most 12 inside my 5-mile circle and 15 outside it, closest first.
- Each plane points the way it's flying, with a short dashed line ahead of its nose (part of the icon, so it always lines up). Faded planes can't be caught.
- Commercial flights show their airline. Small planes, helicopters, and business jets are "Private plane"; anything without a callsign or type, or not recognized, is "Unknown aircraft". Neither can be caught.
- Positions update every 2 seconds when I'm the only zone being watched (every 4 s with two zones, and so on). Once the app has used today's fast allowance, or the main source is refusing, they update every 30 seconds (every minute when the fallback's budget runs low), so planes jump rather than glide. Why: [docs/usage-limits.md](docs/usage-limits.md).

**States**
- Loading: a skeleton, then "Loading flights…".
- Finding me: a spinner next to the location line. Following: "Near Chicago, Illinois · Following your location". The map follows me until I drag it; "Back to me" re-centers. Zoom with + and −, scroll, or pinch.
- The status line above the map is the only flight-data message, worded for what's on the map:
  - Connecting: "Connecting to live updates…", or "Reconnecting… showing the last positions" when planes are shown (it reconnects on its own; after 45 seconds without it, the page says flight data is unavailable).
  - Starting: "Looking for planes near you…" when you've just arrived.
  - Fresh: "Live · updated 12 s ago · 8 planes within 15 mi" or "… · no planes within 15 mi right now" ("updated" is my zone's latest update). It adds "updating every 30 s right now" when updates have dropped to every 30 seconds, or "updating less often to save today's limit" in the fallback's slow mode. It stays fresh until about 3 worker calls pass with no run (under 2 minutes).
  - Stale: "No update for 2 min · these positions may be out of date" while planes are shown, or "No new flight data for 3 min, so there are no recent planes to show" once they've aged off.
- Messages never promise a time ("in 30 s", "back by 6 PM"); they say what's happening. The one exception is my own Radar time: it's a fixed rule the app controls, so the page says how much is left and when it resets (midnight UTC).
- Radar time: each person gets 2 hours a day, counted only while the Radar is open and in front. Once some is used, "1 h 52 min of Radar time left today" shows under the status line. At 0, a panel replaces the status line and planes ("You've used today's 2 hours of Radar … comes back at midnight UTC (in 3 h 12 min). Your collection is still open."), and Catch is refused.
- Stale, down, and daily limit: as in the chart, each shown once (down and limit as a banner, with no extra pill). Down also covers the worker not running at all (no run for 5 minutes) and a lost live connection. Down and limit hide the planes; the map and collection still work.
- Inside an airport zone: a note that only planes outside the grey zone can be caught.
- Opening a plane (on the map or in the lists) marks it on the map (the same size, drawn bold in the accent color, on top of others; its direction line stays grey) and shows its card directly below the map, before everything else, with Catch. The page scrolls only as much as needed to show the card; from the lists, it scrolls back up to the map, and if the plane isn't well in view, the map moves to show it (and you), every time you pick one. Close it with Close, or by tapping empty map.
- Below the map, **In your circle** lists each plane with its own **Catch** button, so several can be caught in a row without opening anything. When one can't be caught, the row says why in a word or two ("Private", "Over ORD", "Caught today", "Waiting for update"). After a catch, the row (and card) show "Caught · +25 pts". **Nearby, outside your circle** is view-only: tap a plane to see it on the map.
- A catch that fails says why, in words (from the database's check).

## Collection

> **I open Collection → I see my totals → I switch between Airlines and Aircraft → each shows what I've caught, rarest first.**

- Totals: planes caught, airlines, aircraft types, points.
- Airlines and Aircraft are tabs (arrow keys move between them). Each row shows the name (airlines with their logo), code, how many times caught, total points, when last caught, and its best rarity.
- Pressing a row opens its catches: each flight's callsign, its aircraft (in Airlines) or airline (in Aircraft), rarity, points earned, and when it was caught. Press again to close.
- Empty: "No airlines yet." / "No aircraft yet.", with a button back to the radar.
