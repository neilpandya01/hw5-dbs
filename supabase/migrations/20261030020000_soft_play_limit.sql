-- Sky Hunt: the daily 2 hours of Radar becomes a soft limit. Past it you keep playing (and catching);
-- your zone just gets 30-second updates instead of 2-second ones, unless someone else watching it
-- is still under their 2 hours. Why: docs/usage-limits.md.

-- "I'm still here": always marks you active now, and keeps counting today's Radar time (up to 2 hours).
-- Returns the seconds left before updates slow down (0 = slowed), or null if you have no row yet.
create or replace function public.touch_hunter() returns integer
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

-- Catching works whatever your Radar time (back to the rules before the daily limit).
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

-- Each zone update says how often that zone is being updated, so the page can say so for this zone
-- (two people in different zones can get different speeds). fast: every few seconds. normal: every
-- 30 s. slow: every 60 s.
alter table public.frames add column if not exists pace text not null default 'fast'
  check (pace in ('fast', 'normal', 'slow'));
