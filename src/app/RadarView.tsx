"use client";

import { useState } from "react";
import { ButtonLink } from "@/components/Button";
import { FeedStatus } from "@/components/FeedStatus";
import { FlightMap } from "@/components/FlightMap";
import { LocationHelp } from "@/components/LocationHelp";
import { EmptyState, PageHeader, PageSkeleton, Section, Spinner } from "@/components/Page";
import { noCatchZoneAt, shortName, useAirports } from "@/lib/airports";
import { CATCH_RANGE_MI } from "@/lib/geo";
import { useLiveLocation } from "@/lib/location";
import { useNearestPlace } from "@/lib/nearestPlace";
import { useStore } from "@/lib/store";

/**
 * The home screen: a map centered on where you are now, your catch range, airport no-catch zones,
 * and the planes near you. Your position follows you while this page is open; the saved copy
 * (rounded) only changes when you've moved a couple of kilometers. Live flights come later, from the worker.
 */
export function RadarView() {
  const store = useStore();
  const [attempt, setAttempt] = useState(0);
  const live = useLiveLocation(attempt);
  const saved = store?.data.location ?? null;
  // Prefer where you are right now; fall back to the last saved spot while finding you or if it fails.
  const center = live.status === "live" ? live.position : saved;
  const place = useNearestPlace(center);
  const airports = useAirports();

  if (!store) return <PageSkeleton label="Loading your map" />;

  const where = place ? `Near ${place}` : center ? "Your location" : "Finding you…";
  const caught = store.data.catches.length;
  const atAirport = center ? noCatchZoneAt(airports, center) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Radar" subtitle={<LocationLine where={where} live={live.status} />} />

      {live.status === "problem" && (
        <div className="flex flex-col gap-2">
          <LocationHelp problem={live.problem} onRetry={() => setAttempt((n) => n + 1)} />
          {saved && <p className="text-sm text-muted">Showing your last saved location until then.</p>}
        </div>
      )}

      <FeedStatus state={{ status: "not-connected" }} />

      <div className="flex flex-col gap-2">
        <FlightMap center={center} airports={airports} caption={`Map around you (${where}). No live flights yet.`}>
          <p className="font-medium text-ink">No live flights yet</p>
          <p className="text-muted">
            Planes within {CATCH_RANGE_MI} miles will show up here once the flight feed is connected.
          </p>
        </FlightMap>
        <Legend />
        {atAirport && (
          <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-ink">
            You&apos;re inside {shortName(atAirport)}&apos;s grey zone. Planes over the zone can&apos;t be caught, but
            ones flying outside it in your range can.
          </p>
        )}
      </div>

      <Section title="Planes near you">
        <EmptyState title="No planes in range right now.">
          <p>When a plane flies within {CATCH_RANGE_MI} miles of you, it&apos;s listed here. Open it to catch it.</p>
        </EmptyState>
      </Section>

      <Section title="Your collection">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-ink">
            {caught === 0 ? "No catches yet." : `${caught} plane${caught === 1 ? "" : "s"} caught.`}
          </p>
          <ButtonLink href="/collection" variant="secondary" size="sm">
            See collection
          </ButtonLink>
        </div>
      </Section>
    </div>
  );
}

/** What the map's colors mean, in words. */
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
