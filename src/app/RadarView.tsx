"use client";

import { useEffect, useRef, useState } from "react";
import { AirlineLogo } from "@/components/AirlineLogo";
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
import { ago, catchBlock, feedState, nearbyPlanes, planeTitle, planeType, VIEW_MI, type NearbyPlane } from "@/lib/nearby";
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const cardHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (selected) cardHeading.current?.focus();
  }, [selected]);

  if (!store) return <PageSkeleton label="Loading your map" />;

  const where = place ? `Near ${place}` : me ? "Your location" : "Finding you…";
  const atAirport = me ? noCatchZoneAt(airports, me) : null;
  const feed = feedState(flights.loaded, flights.error, flights.run, now);
  const showPlanes = feed.status === "fresh" || feed.status === "stale";
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
    setMessage(null);
  }

  async function onCatch(p: NearbyPlane) {
    if (!me) return;
    setBusy(true);
    setMessage(null);
    const result = await catchPlane(p.cell, p.hex, me);
    setBusy(false);
    setMessage(
      result.ok
        ? { tone: "ok", text: `Caught! ${planeTitle(p)} ${planeType(p)} is in your collection.` }
        : { tone: "error", text: CATCH_ERRORS[result.error] },
    );
  }

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
        <FeedStatus feed={feed} now={now} />
        <FeedProblem feed={feed} />
      </div>

      <div className="flex flex-col gap-2">
        <FlightMap
          center={me}
          airports={airports}
          planes={mapPlanes}
          selectedId={current?.hex ?? null}
          onSelect={open}
          caption={`Map around you (${where}). ${inRange.length} planes in your circle, ${outside.length} more nearby.`}
        >
          {showPlanes && shown.length === 0 && (
            <>
              <p className="font-medium text-ink">
                {feed.status === "fresh" && feed.idle ? "Looking for planes near you…" : "No planes nearby right now"}
              </p>
              <p className="text-muted">Planes within {VIEW_MI} miles show up here. It updates about every 30 seconds.</p>
            </>
          )}
        </FlightMap>
        <Legend />
        {atAirport && (
          <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-ink">
            You&apos;re inside {shortName(atAirport)}&apos;s grey zone. Planes over the zone can&apos;t be caught, but
            ones flying outside it in your range can.
          </p>
        )}
      </div>

      {selected &&
        (current ? (
          <PlaneCard
            title={planeTitle(current)}
            iata={current.kind === "commercial" ? current.airlineIata : null}
            aircraft={planeType(current)}
            updated={`Updated ${ago(current.seenAt, now)}`}
            block={catchBlock(current, now, caughtToday)}
            busy={busy}
            message={message}
            headingRef={cardHeading}
            onCatch={() => onCatch(current)}
            onClose={() => setSelected(null)}
          />
        ) : (
          <EmptyState title={message?.tone === "ok" ? message.text : "That plane has flown out of view."}>
            <button type="button" className="font-medium text-accent underline" onClick={() => setSelected(null)}>
              Close
            </button>
          </EmptyState>
        ))}

      {showPlanes && (
        <>
          <Section title={`In your ${CATCH_RANGE_MI}-mile circle (${inRange.length})`}>
            {inRange.length === 0 ? (
              <EmptyState title="No planes in your circle right now.">
                <p>Watch the map: planes heading your way will show up here.</p>
              </EmptyState>
            ) : (
              <PlaneList planes={inRange} now={now} caughtToday={caughtToday} selected={current?.hex ?? null} onOpen={open} />
            )}
          </Section>
          {outside.length > 0 && (
            <Section title={`Nearby, outside your circle (${outside.length})`}>
              <PlaneList planes={outside} now={now} caughtToday={caughtToday} selected={current?.hex ?? null} onOpen={open} />
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

function PlaneList({
  planes,
  now,
  caughtToday,
  selected,
  onOpen,
}: {
  planes: NearbyPlane[];
  now: number;
  caughtToday: Set<string>;
  selected: string | null;
  onOpen: (hex: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {planes.map((p) => {
        const catchable = !catchBlock(p, now, caughtToday);
        return (
          <li key={p.hex}>
            <button
              type="button"
              onClick={() => onOpen(p.hex)}
              aria-pressed={p.hex === selected}
              className={`flex w-full items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 text-left hover:border-control ${
                p.hex === selected ? "border-accent" : "border-line"
              }`}
            >
              <AirlineLogo iata={p.kind === "commercial" ? p.airlineIata : null} size="sm" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium text-ink">{planeTitle(p)}</span>
                <span className="truncate text-sm text-muted">
                  {planeType(p)} · {p.distanceMi.toFixed(1)} mi{p.direction ? ` · heading ${p.direction}` : ""}
                </span>
              </span>
              {catchable ? (
                <span className="shrink-0 rounded-full bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok">Catchable</span>
              ) : caughtToday.has(p.hex) ? (
                <span className="shrink-0 text-xs font-medium text-muted">Caught today</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** What the map's colors and icons mean, in words. */
function Legend() {
  return (
    <ul aria-label="Map key" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
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
        Points the way it&apos;s flying; faded can&apos;t be caught
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
