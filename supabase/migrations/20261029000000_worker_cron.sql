-- Sky Hunt: run the worker (the `worker` Edge Function) on a schedule with Supabase Cron.
--
-- Before this runs, put two secrets in Vault (SQL Editor; never commit the real values):
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/worker', 'sky_hunt_worker_url');
--   select vault.create_secret('<same value as the function''s CRON_SECRET>', 'sky_hunt_cron_secret');
-- To change one later: select vault.update_secret(id, '<new value>') using the id from vault.secrets.
--
-- Turn the worker off:  select cron.unschedule('sky-hunt-worker');
-- See recent calls:     select * from cron.job_run_details order by start_time desc limit 10;
--                       select * from net._http_response order by created desc limit 10;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- pg_net lets the database make HTTP requests (to call the Edge Function).
create extension if not exists pg_net with schema extensions;

-- Every 30 seconds: one run of the worker. It decides for itself whether to fetch (normal), fetch
-- every other time (slow), or not fetch at all (paused, or nobody active), and records every run.
-- The timeout is longer than a run can take (4 requests of at most 6 s each).
-- Scheduling the same name again replaces the job, so this is safe to re-run.
select cron.schedule(
  'sky-hunt-worker',
  '30 seconds',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sky_hunt_worker_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sky_hunt_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Runs older than a week are only history; keep the table small (hourly).
select cron.schedule(
  'sky-hunt-prune-runs',
  '17 * * * *',
  $$ delete from public.runs where started_at < now() - interval '7 days' $$
);

-- Cron keeps a row per job run (about 2,900 a day here); keep one day of them.
select cron.schedule(
  'sky-hunt-prune-cron-history',
  '23 * * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '1 day' $$
);
