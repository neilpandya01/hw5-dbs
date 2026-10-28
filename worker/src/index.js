import { Budget, DAILY_BUDGET, DAY_MS } from "./budget.js";
import { keyOf } from "./changes.js";
import { createDb } from "./db.js";
import { runOnce } from "./run.js";
import { fetchCell } from "./source.js";

// Sky Hunt's worker. Runs all the time on Railway: every 30 seconds (60 when the daily budget is
// getting low), it fetches planes near active players from adsb.lol and saves what changed.
//
// Environment (Railway variables, or worker/.env locally; never in code):
//   SUPABASE_URL         https://<project>.supabase.co
//   SUPABASE_SECRET_KEY  sb_secret_... (skips row-level security; keep it secret)
//
// `npm start` runs forever. `npm run once` does a single run and exits (handy for checking setup).

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY. Set them in Railway's variables (or worker/.env locally).");
  process.exit(1);
}

const once = process.argv.includes("--once");
const db = createDb(SUPABASE_URL, SUPABASE_SECRET_KEY);
const PRUNE_EVERY_MS = 60 * 60_000;
const KEEP_RUNS_MS = 7 * DAY_MS;

async function start() {
  const now = Date.now();
  // Pick up where a previous worker left off: today's request count and the planes already saved.
  const history = await db.requestHistory(new Date(now - DAY_MS).toISOString());
  const saved = new Map((await db.loadSightings()).map((row) => [keyOf(row), row]));
  const state = { saved, budget: new Budget(DAILY_BUDGET, history), cooldownUntil: 0 };
  console.log(
    `[start] ${state.budget.used(now)}/${DAILY_BUDGET} requests used in the last 24h, ${saved.size} planes already saved`,
  );

  let stopping = false;
  let timer = null;
  let lastPrune = 0;
  const stop = () => {
    console.log("[stop] shutting down");
    stopping = true;
    if (timer) clearTimeout(timer);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  const tick = async () => {
    let waitS = 30;
    try {
      ({ waitS } = await runOnce(state, { db, fetchCell }));
      if (Date.now() - lastPrune > PRUNE_EVERY_MS) {
        lastPrune = Date.now();
        await db.pruneRuns(new Date(Date.now() - KEEP_RUNS_MS).toISOString());
      }
    } catch (e) {
      // Never let one bad run stop the worker: log it and try again next time.
      console.log(`[run] unexpected error: ${e.message}`);
    }
    if (once || stopping) return;
    timer = setTimeout(tick, waitS * 1000);
  };
  await tick();
}

start().catch((e) => {
  console.error(`[start] ${e.message}`);
  process.exit(1);
});
