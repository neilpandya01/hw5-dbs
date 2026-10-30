-- Sky Hunt: which flight source answered each run (adsb.lol, or the adsb.fi fallback).
-- Null when the run made no requests or nothing answered.

alter table public.runs add column if not exists source text;
