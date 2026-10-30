-- Sky Hunt: fast updates (every 2 s, bundled per zone) and the usage limits that keep it on the free plan.
-- Why the limits are what they are: docs/usage-limits.md.
--
--   frames    one row per grid cell: the planes that changed in its latest update, in one row, so Realtime
--             sends ONE message per update instead of one per plane. The page listens to this, not sightings.
--   sightings still the saved position of every plane (catch_plane() checks it), but no longer in Realtime.
--   hunters   + play_day, play_seconds: Radar time used today (UTC). touch_hunter() counts it and stops
--             marking you active after 2 hours, so the worker stops fetching for you.
--   runs      + how many requests went to each source, and the worker's estimate of Realtime messages and
--             bytes it caused (its own daily meter for the free plan's monthly quotas).

-- ---------------------------------------------------------------- frames
create table public.frames (
  cell text primary key,
  -- Counts up with every update of this cell.
  seq bigint not null default 1,
  at timestamptz not null default now(),
  -- Sightings rows (same columns as the table) that are new or changed in this update.
  planes jsonb not null default '[]'::jsonb,
  -- Hex codes of planes that left the cell in this update.
  removed text[] not null default '{}'
);

alter table public.frames enable row level security;
create policy "Signed-in people see live updates" on public.frames
  for select to authenticated using (true);
revoke all on public.frames from anon;
grant select on public.frames to authenticated;

-- Realtime: bundles instead of single planes. (Runs stay: one small message per worker call.)
alter publication supabase_realtime drop table public.sightings;
alter publication supabase_realtime add table public.frames;

-- ---------------------------------------------------------------- runs
alter table public.runs drop constraint runs_mode_check;
-- fast:   adsb.fi, one zone every 2 s in turn (the default when today's allowance allows it).
-- normal: one pass every 30 s over up to 4 zones (adsb.fi first, adsb.lol as fallback).
-- slow:   like normal but every 60 s (adsb.lol's daily budget is 75-90% used and adsb.fi is unavailable).
-- paused: no requests (a hard daily limit is reached, or every source refused us lately), until resume_at.
-- idle:   nobody active.
alter table public.runs add constraint runs_mode_check
  check (mode in ('fast', 'normal', 'slow', 'paused', 'idle'));

alter table public.runs
  add column if not exists ticks integer not null default 0,
  add column if not exists fi_requests integer not null default 0,
  add column if not exists lol_requests integer not null default 0,
  add column if not exists fi_requests_24h integer not null default 0,
  add column if not exists messages_est integer not null default 0,
  add column if not exists bytes_est bigint not null default 0,
  add column if not exists messages_24h integer not null default 0,
  add column if not exists bytes_24h bigint not null default 0;

comment on column public.runs.requests_24h is 'adsb.lol requests in the last 24 h (its daily budget is daily_budget)';
comment on column public.runs.messages_est is 'Estimated Realtime messages this run caused (each update x each viewer)';
comment on column public.runs.bytes_est is 'Estimated bytes those messages carried (egress)';

-- Earlier runs: split their requests by the source that answered (before adsb.fi, everything was adsb.lol).
update public.runs set fi_requests = requests where source = 'adsb.fi' and requests > 0;
update public.runs set lol_requests = requests where source is distinct from 'adsb.fi' and requests > 0;

-- Everything the worker needs to know about the last 24 hours, summed here so it reads a few numbers
-- instead of thousands of rows every 30 seconds (that reading would itself cost egress).
create function public.worker_usage() returns jsonb
language sql stable security definer set search_path = ''
as $$
  with recent as (
    select started_at, lol_requests, fi_requests, messages_est, bytes_est, error
    from public.runs where started_at > now() - interval '24 hours'
  )
  select jsonb_build_object(
    'lol_24h', coalesce(sum(lol_requests), 0),
    'fi_24h', coalesce(sum(fi_requests), 0),
    'messages_24h', coalesce(sum(messages_est), 0),
    'bytes_24h', coalesce(sum(bytes_est), 0),
    'lol_limited_at', max(started_at) filter (where error like '%adsb.lol refused%' and started_at > now() - interval '5 minutes'),
    'fi_limited_at', max(started_at) filter (where error like '%adsb.fi refused%' and started_at > now() - interval '5 minutes'),
    -- [ms, requests] for each run that asked adsb.lol: its budget's slow/pause and resume time.
    'lol_events', coalesce(
      jsonb_agg(jsonb_build_array((extract(epoch from started_at) * 1000)::bigint, lol_requests) order by started_at)
        filter (where lol_requests > 0),
      '[]'::jsonb)
  )
  from recent;
$$;
revoke all on function public.worker_usage() from public, anon, authenticated;
grant execute on function public.worker_usage() to service_role;

-- ---------------------------------------------------------------- hunters: daily Radar time
alter table public.hunters
  add column if not exists play_day date,
  add column if not exists play_seconds integer not null default 0;

-- People may only write the columns the page writes. Without this, anyone could reset their own
-- play time or mark themselves active through the API.
revoke insert, update on public.hunters from authenticated;
grant insert (user_id, onboarded) on public.hunters to authenticated;
grant update (onboarded, lat, lon, location_at) on public.hunters to authenticated;

-- "I'm still here", every ~25 s while the Radar is open and visible. Adds the time since the last
-- check-in (at most 30 s; nothing after a gap of over a minute) to today's Radar time, and marks you
-- active. After 2 hours it stops marking you active, so the worker stops fetching for you.
-- Returns the seconds of Radar time left today (0 when used up), or null if you have no row yet.
drop function public.touch_hunter();
create function public.touch_hunter() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  uid text := auth.jwt()->>'sub';
  today date := (now() at time zone 'utc')::date;
  limit_s constant integer := 7200;
  h public.hunters;
  used integer;
begin
  if uid is null then
    return null;
  end if;
  select * into h from public.hunters where user_id = uid for update;
  if not found then
    return null;
  end if;
  used := case when h.play_day = today then h.play_seconds else 0 end;
  if used >= limit_s then
    update public.hunters set play_day = today, play_seconds = used where user_id = uid;
    return 0;
  end if;
  if h.last_active_at > now() - interval '60 seconds' then
    used := used + least(30, greatest(0, extract(epoch from now() - h.last_active_at)::integer));
  end if;
  used := least(used, limit_s);
  update public.hunters
    set play_day = today, play_seconds = used, last_active_at = now()
    where user_id = uid;
  return limit_s - used;
end;
$$;
revoke all on function public.touch_hunter() from public, anon;
grant execute on function public.touch_hunter() to authenticated;

-- ---------------------------------------------------------------- catch_plane: respects the daily limit
-- Same as before, plus: when today's Radar time is used up, catching is refused (PLAY_LIMIT) and doesn't
-- mark you active.
create or replace function public.catch_plane(p_cell text, p_hex text, p_lat double precision, p_lon double precision)
returns public.catches
language plpgsql security definer set search_path = ''
as $$
declare
  uid text := auth.jwt()->>'sub';
  my_lat numeric := round(p_lat::numeric, 2);
  my_lon numeric := round(p_lon::numeric, 2);
  s public.sightings;
  miles double precision;
  c public.catches;
begin
  if uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  if p_lat is null or p_lon is null or abs(p_lat) > 90 or abs(p_lon) > 180 then
    raise exception 'NO_LOCATION';
  end if;

  if exists (
    select 1 from public.hunters
    where user_id = uid and play_day = (now() at time zone 'utc')::date and play_seconds >= 7200
  ) then
    raise exception 'PLAY_LIMIT';
  end if;

  -- Catching also counts as being active here.
  update public.hunters
    set lat = my_lat, lon = my_lon, location_at = now(), last_active_at = now()
    where user_id = uid;
  if not found then
    raise exception 'NO_HUNTER';
  end if;

  select * into s from public.sightings where cell = p_cell and hex = p_hex;
  if not found then
    raise exception 'GONE';
  end if;
  if s.kind <> 'commercial' or s.rarity is null then
    raise exception 'NOT_COMMERCIAL';
  end if;
  if s.seen_at < now() - interval '90 seconds' then
    raise exception 'STALE';
  end if;
  if s.airport is not null then
    raise exception 'AIRPORT_ZONE';
  end if;

  miles := 3958.8 * 2 * asin(sqrt(
    power(sin(radians(s.lat - my_lat::double precision) / 2), 2)
    + cos(radians(my_lat::double precision)) * cos(radians(s.lat))
      * power(sin(radians(s.lon - my_lon::double precision) / 2), 2)
  ));
  if miles > 5.5 then
    raise exception 'OUT_OF_RANGE';
  end if;

  insert into public.catches
    (user_id, hex, callsign, airline_icao, airline_iata, airline_name, type_code, type_name, rarity)
  values
    (uid, s.hex, s.callsign, s.airline_icao, s.airline_iata, s.airline_name, s.type_code, s.type_name, s.rarity)
  on conflict (user_id, hex, caught_on) do nothing
  returning * into c;
  if c.id is null then
    raise exception 'ALREADY_CAUGHT';
  end if;
  return c;
end;
$$;

-- ---------------------------------------------------------------- Cron
-- A worker call now runs for about 22 s (a fetch every 2 s), so give pg_net a little more than that.
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
    timeout_milliseconds := 29000
  );
  $$
);
