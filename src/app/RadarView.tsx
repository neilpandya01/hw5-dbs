"use client";

import { useEffect, useRef, useState } from "react";
import { AirlineLogo, preloadLogos } from "@/components/AirlineLogo";
import { Button } from "@/components/Button";
import { FeedProblem, FeedStatus } from "@/components/FeedStatus";
import { FlightMap, type MapPlane } from "@/components/FlightMap";
import { LocationHelp } from "@/components/LocationHelp";
import { EmptyState, PageHeader, PageSkeleton, Section, Spinner } from "@/components/Page";
import { PlaneCard } from "@/components/PlaneCard";
import { noCatchZoneAt, shortName, useAirports } from "@/lib/airports";
import { cellOf } from "@/lib/cells";
import { useFlights, useNow } from "@/lib/flights";
import { CATCH_RANGE_MI } from "@/lib/geo";
import { useHeartbeat } from "@/lib/heartbeat";
import { useLiveLocation } from "@/lib/location";
import { useNearestPlace } from "@/lib/nearestPlace";
import { ago, catchBlock, catchShort, feedState, nearbyPlanes, planeTitle, planeType, type NearbyPlane } from "@/lib/nearby";
import { rarityInfo } from "@/lib/rarity";
import { catchPlane, useStore, type CatchError } from "@/lib/store";

const CATCH_ERRORS: Record<CatchError, string> = {
  NOT_COMMERCIAL: "Only commercial flights can be caught.",
  STALE: "Its last ping was too old by the time you caught it. Try again after the next update.",
  AIRPORT_ZONE: "It's over an airport zone. Planes near airports can't be caught.",
  OUT_OF_RANGE: `Its last ping was outside your ${CATCH_RANGE_MI}-mile circle.`,
  ALREADY_CAUGHT: "You already caught this plane today.",
  GONE: "It flew out of the area before you caught it.",
  NO_LOCATION: "We need your location to catch planes.",
  FAILED: "That didn't go through. Check your connection and try again.",
};

/**
 * The home screen: a live map centered on you, your 5-mile catch circle, airport zones, and the
 * planes near you (at most 12 inside your circle and 15 outside it, out to 15 miles, closest first).
 * While it's open, it tells the worker you're active (every 25 s), and Realtime brings each update.
 */
export function RadarView() {
  const store = useStore();
  const [attempt, setAttempt] = useState(0);
  const live = useLiveLocation(attempt);
  const saved = store?.data.location ?? null;
  // Prefer where you are right now; fall back to the last saved spot while finding you or if it fails.
  const me = live.status === "live" ? live.position : saved;
  const place = useNearestPlace(me);
  const airports = useAirports();
  const now = useNow(1000);
  // The worker files planes by the cell of your saved (rounded) location; listen to that cell.
  const cell = saved ? cellOf(saved.lat, saved.lon) : null;
  const flights = useFlights(cell);
  useHeartbeat(!!store && !!saved && store.storage !== "load-failed");

  const [selected, setSelected] = useState<string | null>(null);
  // Catching, per plane: which one is being caught, and how each attempt went (shown on its row and card).
  const [busyHex, setBusyHex] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, CatchResult>>({});
  /** Read out by screen readers after a catch from the list (the row itself also changes). */
  const [announcement, setAnnouncement] = useState("");
  const cardHeading = useRef<HTMLHeadingElement>(null);
  const mapBox = useRef<HTMLDivElement>(null);
  // Logos for every airline on the map, downloaded ahead of time so opening a plane shows its logo at once.
  const logoCodes = flights.planes
    .filter((p) => p.kind === "commercial" && p.airlineIata)
    .map((p) => p.airlineIata)
    .sort()
    .join(",");
  useEffect(() => {
    if (logoCodes) preloadLogos(logoCodes.split(","));
  }, [logoCodes]);

  const cardBox = useRef<HTMLDivElement>(null);
  /** Opened from the list below: bring the map back into view (with the card right under it). */
  const openedFromList = useRef(false);
  /** Bumped on every pick from the list, so the map brings that plane into view (even the same one again). */
  const [frameRequest, setFrameRequest] = useState(0);
  // Opening a plane: move keyboard focus to its card (just below the map), then scroll only as much
  // as needed to show it. From the list, scroll back up to the map instead.
  useEffect(() => {
    if (!selected) return;
    cardHeading.current?.focus({ preventScroll: true });
    const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    if (openedFromList.current) mapBox.current?.scrollIntoView({ behavior, block: "start" });
    else cardBox.current?.scrollIntoView({ behavior, block: "nearest" });
    openedFromList.current = false;
  }, [selected]);

  if (!store) return <PageSkeleton label="Loading your map" />;

  const where = place ? `Near ${place}` : me ? "Your location" : "Finding you…";
  const atAirport = me ? noCatchZoneAt(airports, me) : null;
  const feed = feedState(flights, now);
  // Planes show whenever there is data to show; positions older than 2 minutes are hidden either way.
  const showPlanes = feed.status === "fresh" || feed.status === "stale" || feed.status === "connecting" || feed.status === "starting";
  const { inRange, outside } = me && showPlanes ? nearbyPlanes(flights.planes, me, now) : { inRange: [], outside: [] };
  const today = new Date(now).toISOString().slice(0, 10);
  const caughtToday = new Set(store.data.catches.filter((c) => c.caughtAt.slice(0, 10) === today).map((c) => c.hex));
  const shown = [...inRange, ...outside];
  const current = shown.find((p) => p.hex === selected) ?? null;

  const mapPlanes: MapPlane[] = shown.map((p) => ({
    id: p.hex,
    position: p,
    heading: p.heading,
    label: rowLabel(p),
    catchable: !catchBlock(p, now, caughtToday),
  }));

  function open(hex: string) {
    setSelected(hex);
    // A failed attempt's message clears when you look again; a success stays.
    setResults((r) => (r[hex]?.tone === "error" ? omit(r, hex) : r));
  }

  /** From the list below the map: open it, and bring the map (with its card) into view. */
  function openFromList(hex: string) {
    openedFromList.current = true;
    open(hex);
    setFrameRequest((n) => n + 1);
  }

  function close() {
    setSelected(null);
  }

  /** Catch from the map's card or straight from a row in "In your circle". */
  async function onCatch(p: NearbyPlane) {
    if (!me || busyHex) return;
    setBusyHex(p.hex);
    setResults((r) => omit(r, p.hex));
    const result = await catchPlane(p.cell, p.hex, me);
    setBusyHex(null);
    const points = rarityInfo[p.rarity ?? "common"].points;
    const outcome: CatchResult = result.ok
      ? {
          tone: "ok",
          text: `Caught! ${planeTitle(p)} ${planeType(p)} is in your collection. +${points} points.`,
          short: `Caught · +${points} pts`,
        }
      : { tone: "error", text: CATCH_ERRORS[result.error], short: "Didn't catch" };
    setResults((r) => ({ ...r, [p.hex]: outcome }));
    setAnnouncement(outcome.text);
  }

  const card = !selected ? null : current ? (
    <PlaneCard
      title={planeTitle(current)}
      iata={current.kind === "commercial" ? current.airlineIata : null}
      aircraft={planeType(current)}
      updated={`Updated ${ago(current.seenAt, now)}`}
      block={catchBlock(current, now, caughtToday)}
      busy={busyHex === current.hex}
      message={results[current.hex] ?? null}
      headingRef={cardHeading}
      onCatch={() => onCatch(current)}
      onClose={close}
    />
  ) : (
    <div role="status" className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 text-sm">
      <span className="text-ink">
        {results[selected]?.tone === "ok" ? results[selected].text : "That plane has flown out of view."}
      </span>
      <button type="button" className="font-medium text-accent underline" onClick={close}>
        Close
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Radar" subtitle={<LocationLine where={where} live={live.status} />} />

      {live.status === "problem" && (
        <div className="flex flex-col gap-2">
          <LocationHelp problem={live.problem} onRetry={() => setAttempt((n) => n + 1)} />
          {saved && <p className="text-sm text-muted">Showing your last saved location until then.</p>}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <FeedStatus feed={feed} now={now} shown={shown.length} />
        <FeedProblem feed={feed} />
      </div>

      <div ref={mapBox} className="flex scroll-mt-24 flex-col gap-2">
        <FlightMap
          center={me}
          airports={airports}
          planes={mapPlanes}
          selectedId={current?.hex ?? null}
          onSelect={open}
          onMapClick={close}
          frameRequest={frameRequest}
          caption={`Map around you (${where}). ${inRange.length} planes in your circle, ${outside.length} more nearby.`}
        />
        {/* The selected plane, right under the map and before everything else. */}
        {card && (
          <div ref={cardBox} className="scroll-mb-6">
            {card}
          </div>
        )}
        <Legend />
        {atAirport && (
          <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-ink">
            You&apos;re inside {shortName(atAirport)}&apos;s grey zone. Planes over the zone can&apos;t be caught, but
            ones flying outside it in your range can.
          </p>
        )}
      </div>


      <p role="status" className="sr-only">
        {announcement}
      </p>
      {showPlanes && (
        <>
          <Section title={`In your ${CATCH_RANGE_MI}-mile circle (${inRange.length})`}>
            {inRange.length === 0 ? (
              <EmptyState title="No planes in your circle right now.">
                <p>Watch the map: planes heading your way will show up here.</p>
              </EmptyState>
            ) : (
              <PlaneList
                planes={inRange}
                now={now}
                caughtToday={caughtToday}
                selected={current?.hex ?? null}
                onOpen={openFromList}
                catching={{ busyHex, results, onCatch }}
              />
            )}
          </Section>
          {outside.length > 0 && (
            <Section title={`Nearby, outside your circle (${outside.length})`}>
              <PlaneList planes={outside} now={now} caughtToday={caughtToday} selected={current?.hex ?? null} onOpen={openFromList} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function rowLabel(p: NearbyPlane): string {
  const heading = p.direction ? `, heading ${p.direction}` : "";
  return `${planeTitle(p)}, ${planeType(p)}, ${p.distanceMi.toFixed(1)} miles away${heading}`;
}

type CatchResult = { tone: "ok" | "error"; text: string; short: string };

function omit<T>(r: Record<string, T>, key: string): Record<string, T> {
  if (!(key in r)) return r;
  const { [key]: _, ...rest } = r;
  void _;
  return rest;
}

/**
 * Planes as rows: press a row to see the plane on the map. With `catching` (the "In your circle" list),
 * each row also has its own Catch button, or a word or two on why it can't be caught.
 */
function PlaneList({
  planes,
  now,
  caughtToday,
  selected,
  onOpen,
  catching,
}: {
  planes: NearbyPlane[];
  now: number;
  caughtToday: Set<string>;
  selected: string | null;
  onOpen: (hex: string) => void;
  catching?: { busyHex: string | null; results: Record<string, CatchResult>; onCatch: (p: NearbyPlane) => void };
}) {
  return (
    <ul className="flex flex-col gap-2">
      {planes.map((p) => (
        <li
          key={p.hex}
          className={`flex items-center gap-2 rounded-xl border bg-surface pr-3 ${p.hex === selected ? "border-accent" : "border-line"}`}
        >
          <button
            type="button"
            onClick={() => onOpen(p.hex)}
            aria-pressed={p.hex === selected}
            aria-label={`Show ${planeTitle(p)} ${planeType(p)} on the map`}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-bg"
          >
            <AirlineLogo iata={p.kind === "commercial" ? p.airlineIata : null} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium text-ink">{planeTitle(p)}</span>
              <span className="truncate text-sm text-muted">
                {planeType(p)} · {p.distanceMi.toFixed(1)} mi{p.direction ? ` · heading ${p.direction}` : ""}
              </span>
            </span>
          </button>
          {catching && <RowCatch plane={p} now={now} caughtToday={caughtToday} {...catching} />}
        </li>
      ))}
    </ul>
  );
}

/** A row's catch control: Catch, Catching…, "Caught · +25 pts", or why it can't be caught. */
function RowCatch({
  plane,
  now,
  caughtToday,
  busyHex,
  results,
  onCatch,
}: {
  plane: NearbyPlane;
  now: number;
  caughtToday: Set<string>;
  busyHex: string | null;
  results: Record<string, CatchResult>;
  onCatch: (p: NearbyPlane) => void;
}) {
  const result = results[plane.hex];
  if (result?.tone === "ok") return <span className="shrink-0 text-xs font-semibold text-ok">{result.short}</span>;
  if (busyHex === plane.hex) {
    return (
      <Button size="sm" disabled>
        <Spinner /> Catching…
      </Button>
    );
  }
  const why = catchShort(plane, now, caughtToday);
  if (why) return <span className="shrink-0 text-right text-xs font-medium text-muted">{why}</span>;
  return (
    <span className="flex shrink-0 flex-col items-end gap-0.5">
      <Button size="sm" onClick={() => onCatch(plane)} disabled={!!busyHex} aria-label={`Catch ${planeTitle(plane)} ${planeType(plane)}`}>
        {result?.tone === "error" ? "Try again" : "Catch"}
      </Button>
      {result?.tone === "error" && <span className="text-xs text-danger">{result.short}</span>}
    </span>
  );
}

/** What the map's colors and icons mean, in words. */
function Legend() {
  return (
    <ul aria-label="Map key" className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-3 rounded-full border-2 border-white bg-[var(--range)]" />
        You
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-3 rounded-full border border-[var(--range)] bg-[var(--range)]/15" />
        {CATCH_RANGE_MI}-mile catch range
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-3 rounded-full border border-dashed border-[var(--zone)] bg-[var(--zone)]/30" />
        Airport: no catching
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true">✈</span>
        Plane
      </li>
    </ul>
  );
}

function LocationLine({ where, live }: { where: string; live: "locating" | "live" | "problem" }) {
  return (
    <span className="inline-flex items-center gap-2">
      {live === "locating" && <Spinner />}
      {where}
      {live === "live" && (
        <>
          <span aria-hidden="true">·</span>
          <span className="text-ok">Following your location</span>
        </>
      )}
    </span>
  );
}
