// The shared daily request budget for adsb.lol. One worker serves every player, so this is app-wide.
//
// adsb.lol allows 500 requests per rolling 24 hours (its x-ratelimit-limit header: "500;w=86400").
//   under 75% used  → normal: a run every 30 seconds
//   75% to 90%      → slow:   a run every 60 seconds
//   90% or more     → paused: no requests until enough of the last 24 hours' requests age out
// The worker counts its own requests (saved in `runs`, so a restart doesn't forget them).

export const DAILY_BUDGET = 500;
export const SLOW_AT = 0.75;
export const PAUSE_AT = 0.9;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Seconds until the next run, per mode. Paused and idle runs still check in, without requests. */
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
