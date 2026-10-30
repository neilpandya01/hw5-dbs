# Sky Hunt: usage limits, and why

Sky Hunt runs entirely on free plans (Supabase, Vercel, Clerk) and two free flight APIs. The assignment asks us to stay on the free tier, and a free Supabase project that runs past its monthly quotas can be restricted, which would take the game down for everyone until the next month. So the app limits itself **per day**: each day may use about one thirtieth of a month's allowance. This page lists every limit, the number behind it, and what a player sees when it's reached.

The numbers live in code in [`supabase/functions/worker/src/limits.js`](../supabase/functions/worker/src/limits.js) (the worker) and in the database functions in [`supabase/migrations/`](../supabase/migrations/) (per person).

## The free plans we have to fit in

| Service | Free allowance | What uses it |
|---|---|---|
| Supabase Realtime | **2,000,000 messages a month**; at most 100 a second and 200 open connections | Every update the worker writes is one message **to each person watching** that zone |
| Supabase egress | **5 GB a month** | Those messages' bytes, plus the page loading planes and your collection |
| Supabase Edge Functions | 500,000 calls a month | Cron calls the worker every 30 s: 2,880 a day, 86,400 a month (17%), however many people play |
| adsb.fi | 1 request per second per IP; errors (including 429) can earn a temporary ban; personal, non-commercial use with credit | Fast updates |
| adsb.lol | No published number ("dynamic based on load"), per IP | Fallback |

**A day's share** = a month ÷ 30: **66,666 Realtime messages** and **about 167 MB** of egress.

## Why updates are bundled

Fast updates send each zone's changes every 2 seconds. If each plane were its own message (how Sky Hunt first worked), one person watching Chicago (about 45 planes, most of them moving a quarter mile every few seconds) would receive about 15 messages a second: **about 54,000 an hour**, most of a day's share in one hour, and a handful of players would hit the 100-a-second cap.

So the worker writes each zone's update as **one row** in `frames`: the planes that changed and the ones that left. Realtime sends it as **one message** per person watching. One person in fast mode receives about **1,440 messages an hour** (11 updates per 30-second call plus one run record, measured on Oct 30, 2026 over Chicago). The bytes are about the same either way (the same planes travel), so **egress becomes the limit that matters**.

## The limits

### 1. App-wide: how fast updates may go today

The worker meters itself. For every update it writes, it adds one message per person watching that zone, and that many copies of the update's size (plus about 350 bytes of Realtime wrapping). Each `runs` row counts once per person on the Radar. It saves these estimates on each run (`messages_est`, `bytes_est`, and the 24-hour totals `messages_24h`, `bytes_24h`). Before each call it sums the last 24 hours (`worker_usage()`).

| Used in the last 24 h (the larger of messages and bytes, as a share of a day's share) | Updates | Why this line |
|---|---|---|
| Under 50% | **Fast**: one zone every 2 s, taking turns (1 zone: every 2 s; 2 zones: every 4 s each; up to 8 zones, busiest first) | Measured: about 9 MB per viewer-hour over Chicago (about 77 KB per 30-second call: 11 updates of about 19 changed planes each), so half a day's share (83 MB) covers about 9 viewer-hours of fast play a day |
| 50% to 90% | **Every 30 s** for everyone (up to 4 zones, busiest first) | Estimated at about 1.7 MB per viewer-hour (one update of most of the zone's planes every 30 s), about 1/5 of fast: roughly 40 more viewer-hours |
| 90% or more | **Paused** for everyone ("Sky Hunt has reached today's flight data limit") | The last 10% is headroom for what the worker can't see: page loads, collections, reconnects |

It's a rolling 24 hours, not a midnight reset, so it eases back gradually. The estimate is deliberately simple: it counts each person active in a zone (checked in during the last minute) as one viewer. It doesn't see page loads, a second tab, or a tab hidden for under a minute; the 10% headroom is for those. To check it against reality, compare with **Organization → Usage** in the Supabase dashboard.

### 2. Per person: 2 hours of fast updates a day, then 30-second updates

Without this, one person leaving the Radar open could spend the whole day's fast allowance, and everyone after them would get 30-second updates. With it, one player's fast updates cost at most about 18 MB a day (2 hours at about 9 MB an hour), under a quarter of the day's fast allowance, so at least four people get them in full. Nobody is ever stopped: past 2 hours you keep playing and catching, just at the 30-second pace (about 1/5 of the cost).

- `touch_hunter()` (the Radar's check-in every 25 s while it's open and in front) marks you active and adds the time since the last check-in (at most 30 s, and nothing after a gap of over a minute) to `hunters.play_seconds` for today (UTC). So only time with the Radar in front of you counts. It returns the seconds left before you're slowed.
- The worker reads each active person's `play_seconds`. A zone where **everyone watching** has played 2 hours today gets one turn per worker call (every 30 s), slotted between the fast zones' turns so adsb.fi still gets at most one request every 2 s. A zone with anyone still under 2 hours stays fast, so a slowed player never slows down a friend nearby.
- Each update records its zone's pace (`frames.pace`), so the page knows how fast its own zone is updating.
- There's no timer on the page. When your zone has been slowed because of your 2 hours, the status line adds a few words: "2 h played today, slower updates". It resets at midnight UTC.
- People can't write `last_active_at` or `play_seconds` themselves: the `hunters` table only lets the page write `onboarded`, `lat`, `lon`, and `location_at`; activity and Radar time change only through `touch_hunter()` and `catch_plane()`.

### 3. Per source: request budgets

| Source | Our cap | Why |
|---|---|---|
| adsb.fi | At most 1 request every 2 s in fast mode (half its 1/s limit), at least 1.1 s apart in a 30-second pass; **12,000 a day** (then the pass uses adsb.lol) | Stays under its per-second limit even with other Supabase projects sharing our IP; 12,000 is about 6.7 hours of one zone at full speed, and keeps us a light user (its terms ask heavy users to get permission) |
| adsb.lol | **500 per rolling 24 h**: every 30 s under 75%, every 60 s from 75% to 90%, none from 90% | The number it once advertised; it's only the fallback now. Only adsb.lol requests count toward it |
| Either | A source that answers 429 is skipped for 5 minutes | adsb.fi bans IPs that keep getting errors; when both are refusing, updates pause |

### 4. Tabs nobody is looking at

The Radar stops checking in when its tab is hidden, so the worker stops fetching for you a minute later. After a minute hidden, the page also **closes its live connection**, because a hidden tab still receives every run record (2,880 a day), and each one counts. It reconnects and reloads when you come back.

## What a player sees

| Situation | On the Radar |
|---|---|
| Normal day | "Live · updated 2 s ago · 9 planes within 15 mi" |
| Fast allowance used for everyone, or adsb.fi refusing or at its daily cap | "Live · updated 12 s ago · … · updating every 30 s right now" |
| adsb.lol's budget 75-90% (adsb.fi unavailable) | "… · updating less often to save today's limit" |
| 90% of the day's share, both sources refusing, or adsb.fi unavailable with adsb.lol's budget 90% used | Banner: "Sky Hunt has reached today's flight data limit." (planes hidden) |
| You've played 2 hours today (and nobody else in your zone is under 2 hours) | "Live · updated 14 s ago · … · 2 h played today, slower updates" (updates every 30 s; catching works as usual) |

## Checking usage

In Supabase's SQL Editor:

```sql
select started_at, mode, ticks, fi_requests_24h, requests_24h as lol_requests_24h,
       messages_24h, round(bytes_24h / 1e6, 1) as mb_24h
from runs order by started_at desc limit 1;
```

Compare with **Organization → Usage** in the Supabase dashboard, which shows the real Realtime messages and egress for the month.

## Measured (Oct 30, 2026, one player over Chicago, fast mode)

| Per 30-second call | Value |
|---|---|
| Time | 20.2 s (11 adsb.fi requests, no refusals), well under Cron's 30 s and pg_net's 29 s timeout |
| Planes in the zone | about 42 |
| Planes changed per 2-second update | about 19 (about half: airliners move a quarter mile every 3 to 4 s) |
| Realtime messages | 12 (11 updates + 1 run record) |
| Estimated bytes | about 77 KB |
| Per viewer-hour | about 1,440 messages and 9 MB |
