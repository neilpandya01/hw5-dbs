"use client";

import { useState } from "react";
import { ButtonLink } from "@/components/Button";
import { FeedStatus } from "@/components/FeedStatus";
import { LocationHelp } from "@/components/LocationHelp";
import { EmptyState, PageHeader, PageSkeleton, Section, Spinner } from "@/components/Page";
import { Radar } from "@/components/Radar";
import { CATCH_RANGE_MI } from "@/lib/geo";
import { useLiveLocation } from "@/lib/location";
import { useNearestPlace } from "@/lib/nearestPlace";
import { useStore } from "@/lib/store";

/**
 * The home screen: a radar centered on where you are now, and the planes near you.
 * Your position follows you while this page is open; the saved copy (rounded) only changes
 * when you've moved a couple of kilometers. Live flights come later, from the worker.
 */
export function RadarView() {
  const store = useStore();
  const [attempt, setAttempt] = useState(0);
  const live = useLiveLocation(attempt);
  const saved = store?.data.location ?? null;
  // Prefer where you are right now; fall back to the last saved spot while finding you or if it fails.
  const center = live.status === "live" ? live.position : saved;
  const place = useNearestPlace(center);

  if (!store) return <PageSkeleton label="Loading your radar" />;

  const where = place ? `Near ${place}` : center ? "Your location" : "Finding you…";
  const caught = store.data.catches.length;

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

      <Radar center={center} caption={`Radar around you (${where}). No live flights yet.`}>
        <p className="font-medium text-ink">No live flights yet</p>
        <p className="text-muted">Planes within {CATCH_RANGE_MI} miles will show up here once the flight feed is connected.</p>
      </Radar>

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
