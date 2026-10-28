"use client";

import type { RefObject } from "react";
import { CATCH_RANGE_MI } from "@/lib/geo";
import { rarityInfo, type Rarity } from "@/lib/rarity";
import { Button } from "./Button";
import { RarityBadge } from "./RarityBadge";

export type PlaneDetails = {
  callsign: string;
  airline: string | null;
  aircraft: string | null;
  rarity: Rarity;
  distanceMi: number;
  direction: string;
  altitudeFt?: number | null;
};

/**
 * One plane, opened from the radar or the list: who it is, how rare, how far, and Catch.
 * Catch only works while the plane is inside your catch range and not over an airport's no-catch zone;
 * otherwise the card says why.
 */
export function PlaneCard({
  plane,
  headingRef,
  practice = false,
  noCatchZone = null,
  onCatch,
  onClose,
}: {
  plane: PlaneDetails;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  practice?: boolean;
  /** The airport whose grey zone the plane is in, if any: "Chicago O'Hare International". */
  noCatchZone?: string | null;
  onCatch: () => void;
  onClose: () => void;
}) {
  const inRange = plane.distanceMi <= CATCH_RANGE_MI;
  const catchable = inRange && !noCatchZone;
  const tier = rarityInfo[plane.rarity];
  return (
    <section aria-labelledby="plane-card-title" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="plane-card-title" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">
            {plane.airline ?? "Private or unknown"} · <span className="font-mono">{plane.callsign}</span>
          </h2>
          <p className="text-sm text-muted">{plane.aircraft ?? "Aircraft type unknown"}</p>
        </div>
        <RarityBadge rarity={plane.rarity} />
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-muted">Distance</dt>
          <dd className="font-medium text-ink">{plane.distanceMi.toFixed(1)} mi {plane.direction}</dd>
        </div>
        <div>
          <dt className="text-muted">Altitude</dt>
          <dd className="font-medium text-ink">{plane.altitudeFt != null ? `${plane.altitudeFt.toLocaleString()} ft` : "Unknown"}</dd>
        </div>
        <div>
          <dt className="text-muted">Worth</dt>
          <dd className="font-medium text-ink">{tier.points} points</dd>
        </div>
      </dl>
      <p aria-live="polite" className={`text-sm ${catchable ? "text-ok" : "text-muted"}`}>
        {!inRange
          ? `Out of range. Wait until it's inside your ${CATCH_RANGE_MI}-mile circle.`
          : noCatchZone
            ? `It's over ${noCatchZone}'s grey zone. Planes near airports can't be caught.`
            : practice
              ? "It's in range. Catch it!"
              : "In range. Catch it before it leaves!"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onCatch} disabled={!catchable}>
          Catch
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </section>
  );
}
