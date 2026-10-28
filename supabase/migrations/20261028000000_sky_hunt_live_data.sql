-- Sky Hunt: hunters, live sightings (written by the worker), catches, and the worker's runs.
--
-- Who writes what:
--   hunters    each person, their own row (rounded location, onboarding, last active)
--   sightings  only the worker (secret key, bypasses row-level security); signed-in people read
--   runs       only the worker; signed-in people read (freshness on the page)
--   catches    only through catch_plane(), which checks the rules; each person reads their own
--
-- user_id is the Clerk user ID from the session token: auth.jwt()->>'sub'.

-- ---------------------------------------------------------------- hunters
create table public.hunters (
  user_id text primary key default (auth.jwt()->>'sub'),
  onboarded boolean not null default false,
  -- Rounded to 2 decimals (about 1 km). Never an exact position.
  lat numeric(4,2) check (lat between -90 and 90),
  lon numeric(5,2) check (lon between -180 and 180),
  location_at timestamptz,
  -- Set every ~25 s while the page is open. The worker only polls areas with someone active
  -- in the last minute.
  last_active_at timestamptz,
  created_at timestamptz not null default now()
);

create index hunters_active_idx on public.hunters (last_active_at);

alter table public.hunters enable row level security;

create policy "Hunters read their own row" on public.hunters
  for select to authenticated using (user_id = auth.jwt()->>'sub');
create policy "Hunters create their own row" on public.hunters
  for insert to authenticated with check (user_id = auth.jwt()->>'sub');
create policy "Hunters update their own row" on public.hunters
  for update to authenticated
  using (user_id = auth.jwt()->>'sub') with check (user_id = auth.jwt()->>'sub');

revoke all on public.hunters from anon;
grant select, insert, update on public.hunters to authenticated;

-- "I'm still here": stamps last_active_at with the database's clock (not the browser's).
create function public.touch_hunter() returns void
language sql security invoker set search_path = ''
as $$
  update public.hunters set last_active_at = now() where user_id = auth.jwt()->>'sub';
$$;
revoke all on function public.touch_hunter() from public, anon;
grant execute on function public.touch_hunter() to authenticated;

-- ---------------------------------------------------------------- sightings
-- One row per plane per grid cell (a plane near a cell border can be in two). Only planes in the air
-- near someone active are kept; the worker deletes planes that leave.
create table public.sightings (
  cell text not null,
  hex text not null,
  callsign text,
  -- commercial: an airline flight on an airliner (catchable). private: small planes, helicopters,
  -- business jets, tail-number callsigns. unknown: missing callsign or aircraft type, or not recognized.
  kind text not null check (kind in ('commercial', 'private', 'unknown')),
  airline_icao text,
  airline_iata text,
  airline_name text,
  type_code text,
  type_name text,
  rarity text check (rarity in ('common', 'uncommon', 'rare', 'legendary')),
  lat double precision not null,
  lon double precision not null,
  alt_ft integer,
  speed_kt real,
  -- Direction of travel, degrees from north.
  heading real,
  -- The airport whose no-catch zone it was in at its last ping, if any.
  airport text,
  -- When its position was last pinged (from the source, not when we saved it).
  seen_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (cell, hex)
);

alter table public.sightings enable row level security;
create policy "Signed-in people see live planes" on public.sightings
  for select to authenticated using (true);
revoke all on public.sightings from anon;
grant select on public.sightings to authenticated;

-- ---------------------------------------------------------------- runs
-- One row per worker run: when, whether it worked, how much changed, and the shared daily budget.
create table public.runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean not null,
  -- normal: every 30 s (under 75% of the daily budget). slow: every 60 s (75-90%).
  -- paused: no requests (90%+), until resume_at. idle: nobody active, nothing fetched.
  mode text not null check (mode in ('normal', 'slow', 'paused', 'idle')),
  cells integer not null default 0,
  requests integer not null default 0,
  requests_24h integer not null default 0,
  daily_budget integer not null,
  upserted integer not null default 0,
  deleted integer not null default 0,
  rows_changed integer not null default 0,
  resume_at timestamptz,
  error text
);

create index runs_started_idx on public.runs (started_at desc);

alter table public.runs enable row level security;
create policy "Signed-in people see worker runs" on public.runs
  for select to authenticated using (true);
revoke all on public.runs from anon;
grant select on public.runs to authenticated;

-- ---------------------------------------------------------------- catches
create table public.catches (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default (auth.jwt()->>'sub'),
  hex text not null,
  callsign text,
  airline_icao text,
  airline_iata text,
  airline_name text,
  type_code text,
  type_name text,
  rarity text not null check (rarity in ('common', 'uncommon', 'rare', 'legendary')),
  caught_at timestamptz not null default now(),
  -- The same aircraft can be caught once per day (UTC).
  caught_on date not null default ((now() at time zone 'utc')::date),
  unique (user_id, hex, caught_on)
);

create index catches_user_idx on public.catches (user_id, caught_at desc);

alter table public.catches enable row level security;
create policy "Hunters see their own catches" on public.catches
  for select to authenticated using (user_id = auth.jwt()->>'sub');
-- No insert, update, or delete for people: catches are only made by catch_plane() below.
revoke all on public.catches from anon;
grant select on public.catches to authenticated;

-- ---------------------------------------------------------------- catching
-- Catch a plane. The page sends where you are (rounded here to about 1 km); this checks, at the plane's
-- last ping: it's a commercial flight, the ping is fresh, it was within 5 miles of you (plus half a mile
-- for the rounding), and it wasn't over an airport's no-catch zone. Errors are short codes the page explains.
create function public.catch_plane(p_cell text, p_hex text, p_lat double precision, p_lon double precision)
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
revoke all on function public.catch_plane(text, text, double precision, double precision) from public, anon;
grant execute on function public.catch_plane(text, text, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------- Realtime
-- The page listens for changed planes and new runs. Hunters and catches aren't broadcast.
alter publication supabase_realtime add table public.sightings, public.runs;
