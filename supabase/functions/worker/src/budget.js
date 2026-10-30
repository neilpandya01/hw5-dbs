// adsb.lol's daily request budget: ours, app-wide (one worker serves every player). adsb.lol is the
// fallback source, used at the old pace when adsb.fi is unavailable (see run.js).
//
// adsb.lol publishes no fixed limit ("dynamic based on load"); 500 per rolling 24 hours is what it
// once advertised, and we keep it as our own cap:
//   under 75% used  → normal: requests every call (every 30 seconds)
//   75% to 90%      → slow:   every other call (every 60 seconds)
//   90% or more     → paused: no adsb.lol requests until enough of the last 24 hours' age out
// Each call reads the last 24 hours of adsb.lol requests back from `runs` (worker_usage()).

export const DAILY_BUDGET = 500;
export const SLOW_AT = 0.75;
export const PAUSE_AT = 0.9;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Seconds between requests, per mode (the page uses the same numbers to judge staleness). */
export const INTERVAL_S = { normal: 30, slow: 60, paused: 60, idle: 30 };

export function modeFor(used, budget = DAILY_BUDGET) {
  const share = used / budget;
  if (share < SLOW_AT) return "normal";
  if (share < PAUSE_AT) return "slow";
  return "paused";
}

export class Budget {
  /** @param history [{ at: ms, requests: n }] from recent runs */
  constructor(budget = DAILY_BUDGET, history = []) {
    this.budget = budget;
    this.events = history.filter((e) => e.requests > 0).sort((a, b) => a.at - b.at);
  }

  record(at, requests = 1) {
    if (requests > 0) this.events.push({ at, requests });
  }

  /** Requests in the 24 hours before `now`. */
  used(now) {
    this.events = this.events.filter((e) => e.at > now - DAY_MS);
    return this.events.reduce((sum, e) => sum + e.requests, 0);
  }

  mode(now) {
    return modeFor(this.used(now), this.budget);
  }

  /** When usage will drop back under the pause line, as old requests age out. Null if not paused. */
  resumeAt(now) {
    let used = this.used(now);
    if (used < this.budget * PAUSE_AT) return null;
    for (const e of this.events) {
      used -= e.requests;
      if (used < this.budget * PAUSE_AT) return e.at + DAY_MS;
    }
    return now;
  }
}
