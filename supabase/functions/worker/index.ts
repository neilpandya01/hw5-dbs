// Sky Hunt's worker: a Supabase Edge Function. Supabase Cron calls it every 30 seconds
// (supabase/migrations/20261029000000_worker_cron.sql). Each call is one run of about 20 seconds
// (src/run.js): it fetches planes near active players (adsb.fi every 2 s, adsb.lol as the fallback),
// saves only what changed, bundles each zone's changes into one `frames` row, and records the run in `runs`.
//
// Environment, all on Supabase's servers (never in code):
//   SUPABASE_URL                                  provided by Supabase
//   SUPABASE_SECRET_KEYS / SUPABASE_SERVICE_ROLE_KEY  provided by Supabase (skips row-level security)
//   CRON_SECRET                                   set by you (Edge Functions → Secrets); Cron sends it
//                                                 in `x-cron-secret`, so nobody else can spend the budget
//
// The function is deployed without JWT checks (supabase/config.toml), because the cron secret is
// what proves the caller.

import { createDb } from "./src/db.ts";
import { loadState, runOnce } from "./src/run.js";
import { fetchCell } from "./src/source.js";

/** The project's secret key. Newer projects get `sb_secret_…` keys; older ones the service_role key. */
function secretKey(): string | undefined {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, string>;
      const key = parsed.default ?? Object.values(parsed)[0];
      if (key) return key;
    } catch {
      // Fall through to the legacy key.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

/** Compares without stopping at the first different character, so timing doesn't leak the secret. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Use POST.", { status: 405 });

  const cronSecret = Deno.env.get("CRON_SECRET");
  const sent = req.headers.get("x-cron-secret") ?? "";
  if (!cronSecret || !sameSecret(sent, cronSecret)) return new Response("Not allowed.", { status: 401 });

  const url = Deno.env.get("SUPABASE_URL");
  const key = secretKey();
  if (!url || !key) {
    console.error("[run] missing SUPABASE_URL or the secret key in the function's environment");
    return new Response("Worker isn't configured.", { status: 500 });
  }

  const db = createDb(url, key);
  const state = await loadState(db, Date.now());
  const { run } = await runOnce(state, { db, fetchCell });
  return Response.json(run, { status: run.ok ? 200 : 502 });
});
