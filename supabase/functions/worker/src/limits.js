// Sky Hunt's usage limits: what keeps one free Supabase project (and two free flight APIs) working for
// everyone, every day. The reasoning and the math are in docs/usage-limits.md.
//
// Supabase's free plan, per month:  2,000,000 Realtime messages · 5 GB egress · 500,000 Edge Function calls
//                                   (and at most 100 Realtime messages a second, 200 open connections)
// Spread evenly over 30 days, that's what one day may use. The worker meters its own share of it:
// every update it writes is one Realtime message to each person watching that zone.

const DAYS = 30;
export const FREE_PLAN = {
  realtimeMessagesPerMonth: 2_000_000,
  egressBytesPerMonth: 5 * 1000 ** 3,
};
export const DAILY_SHARE = {
  messages: Math.floor(FREE_PLAN.realtimeMessagesPerMonth / DAYS), // 66,666
  bytes: Math.floor(FREE_PLAN.egressBytesPerMonth / DAYS), // about 167 MB
};

/** Fast updates (every 2 s) until the worker's estimate reaches half of a day's share... */
export const FAST_UNTIL = 0.5;
/** ...then 30-second updates, until 90% (the other 10% covers what the worker can't see: page loads). */
export const STOP_AT = 0.9;

/**
 * adsb.fi publishes no daily cap, only 1 request per second per IP. Ours keeps Sky Hunt a light user:
 * 12,000 a day is about 6.7 hours of fast updates for one zone (a request every 2 s).
 */
export const FI_DAILY_CAP = 12_000;

/**
 * Each person's fast Radar time per day (UTC), counted by touch_hunter() in the database. Past it they
 * keep playing; their zone just drops to 30-second updates unless someone else there is still under it.
 */
export const PLAY_LIMIT_S = 2 * 60 * 60;

/** Realtime's wrapper around each message (topic, event, schema, commit time...), roughly. */
export const MESSAGE_OVERHEAD_BYTES = 350;
/** A `runs` row as Realtime sends it. */
export const RUN_MESSAGE_BYTES = 900;

/**
 * How fast updates may go, from the last 24 hours of the worker's own estimates.
 *   fast    under 50% of a day's share of both messages and bytes
 *   normal  50% to 90%: 30-second updates
 *   stop    90% or more: no updates until the oldest usage ages out
 */
export function paceFor(messages24h, bytes24h) {
  const share = Math.max(messages24h / DAILY_SHARE.messages, bytes24h / DAILY_SHARE.bytes);
  if (share >= STOP_AT) return "stop";
  if (share >= FAST_UNTIL) return "normal";
  return "fast";
}
