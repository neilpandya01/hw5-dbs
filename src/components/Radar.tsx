"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { CATCH_RANGE_MI, offsetMi, type LatLon } from "@/lib/geo";

export type RadarPlane = {
  id: string;
  position: LatLon;
  /** Degrees, 0 = north. */
  heading: number;
  /** Read aloud and shown on hover: "Lufthansa 747-8, 6 miles northeast". */
  label: string;
  /** Faded when it can't be caught (out of range, or over an airport). */
  catchable: boolean;
};

/** A grey no-catch zone around an airport. */
export type RadarZone = { id: string; position: LatLon; radiusMi: number; label: string };

const SIZE = 200;
const MID = SIZE / 2;
const RADIUS = 94;
/** The edge of the radar, in miles from you. The catch range sits inside it. */
const VIEW_MI = CATCH_RANGE_MI * 1.5;
const toPx = (mi: number) => (mi / VIEW_MI) * RADIUS;

const PLANE_PATH =
  "M0,-6 L1,-2 L6,1 L6,2.5 L1,1.2 L0.8,4 L2.5,5.4 L2.5,6.3 L0,5.6 L-2.5,6.3 L-2.5,5.4 L-0.8,4 L-1,1.2 L-6,2.5 L-6,1 L-1,-2 Z";

/**
 * The onboarding radar: you in the middle, your catch range as a ring, grey airport zones, planes around you.
 * A drawing, not a street map (the live page uses FlightMap). Everything on it is also listed in text on the page,
 * so nothing depends on seeing it. Planes are buttons (Tab, then Enter or Space).
 */
export function Radar({
  center,
  planes = [],
  zones = [],
  selectedId,
  onSelect,
  caption,
  children,
}: {
  /** null while finding you: the radar shows without the "you" dot. */
  center: LatLon | null;
  planes?: RadarPlane[];
  zones?: RadarZone[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** A short summary for screen readers: "Radar around Chicago. 2 planes in range." */
  caption: string;
  /** Laid over the lower half of the radar, e.g. an empty-state message. */
  children?: ReactNode;
}) {
  const range = toPx(CATCH_RANGE_MI);

  function onKey(e: KeyboardEvent, id: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(id);
    }
  }

  return (
    <figure className="relative mx-auto aspect-square w-full max-w-md">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full" role="group" aria-label={caption}>
        <defs>
          <clipPath id="radar-clip">
            <circle cx={MID} cy={MID} r={RADIUS} />
          </clipPath>
        </defs>
        <circle cx={MID} cy={MID} r={RADIUS} fill="var(--radar-bg)" stroke="var(--radar-ring)" />
        <g aria-hidden="true">
          {/* A ring halfway to the catch range, plus north-south and east-west lines. */}
          <circle cx={MID} cy={MID} r={toPx(CATCH_RANGE_MI / 2)} fill="none" stroke="var(--radar-ring)" strokeWidth="0.6" />
          {/* Airport no-catch zones, cut off at the radar's edge. */}
          <g clipPath="url(#radar-clip)">
            {center &&
              zones.map((z) => {
                const { x, y } = offsetMi(center, z.position);
                return (
                  <g key={z.id}>
                    <circle
                      cx={MID + toPx(x)}
                      cy={MID - toPx(y)}
                      r={toPx(z.radiusMi)}
                      fill="var(--zone)"
                      fillOpacity="0.3"
                      stroke="var(--zone)"
                      strokeWidth="0.6"
                      strokeDasharray="2 2"
                    />
                    <text x={MID + toPx(x)} y={MID - toPx(y) + 2} fontSize="5.5" fontWeight="600" fill="var(--ink)" textAnchor="middle">
                      {z.label}
                    </text>
                  </g>
                );
              })}
          </g>
          <line x1={MID} y1={MID - RADIUS} x2={MID} y2={MID + RADIUS} stroke="var(--radar-ring)" strokeWidth="0.5" />
          <line x1={MID - RADIUS} y1={MID} x2={MID + RADIUS} y2={MID} stroke="var(--radar-ring)" strokeWidth="0.5" />
          {/* The catch range. */}
          <circle
            cx={MID}
            cy={MID}
            r={range}
            fill="var(--radar-range)"
            fillOpacity="0.07"
            stroke="var(--radar-range)"
            strokeWidth="0.9"
            strokeDasharray="3 2"
          />
          <text x={MID + 2} y={MID - range - 2} fontSize="6" fill="var(--muted)">
            {CATCH_RANGE_MI} mi
          </text>
          {/* Compass letters. */}
          {[
            ["N", MID, MID - RADIUS + 9],
            ["S", MID, MID + RADIUS - 4],
            ["E", MID + RADIUS - 7, MID + 2],
            ["W", MID - RADIUS + 3, MID + 2],
          ].map(([t, x, y]) => (
            <text key={t as string} x={x as number} y={y as number} fontSize="7" fontWeight="600" fill="var(--muted)" textAnchor={t === "N" || t === "S" ? "middle" : "start"}>
              {t}
            </text>
          ))}
          {/* The sweep. */}
          <g clipPath="url(#radar-clip)">
            <path
              className="radar-sweep"
              d={`M${MID},${MID} L${MID},${MID - RADIUS} A${RADIUS},${RADIUS} 0 0,1 ${MID + RADIUS * Math.sin(Math.PI / 7)},${MID - RADIUS * Math.cos(Math.PI / 7)} Z`}
              fill="var(--radar-range)"
              fillOpacity="0.1"
            />
          </g>
          {/* You. */}
          {center && (
            <>
              <circle className="radar-pulse" cx={MID} cy={MID} r="4" fill="var(--radar-you)" />
              <circle cx={MID} cy={MID} r="3.2" fill="var(--radar-you)" stroke="var(--surface)" strokeWidth="1.2" />
            </>
          )}
        </g>

        {center &&
          planes.map((p) => {
            const { x, y } = offsetMi(center, p.position);
            if (Math.hypot(x, y) > VIEW_MI) return null;
            const px = MID + toPx(x);
            const py = MID - toPx(y);
            const selected = p.id === selectedId;
            return (
              <g
                key={p.id}
                role="button"
                tabIndex={0}
                aria-label={p.label}
                aria-pressed={selected}
                onClick={() => onSelect?.(p.id)}
                onKeyDown={(e) => onKey(e, p.id)}
                className="cursor-pointer outline-none [&:focus-visible_.plane-focus]:opacity-100"
                transform={`translate(${px} ${py})`}
              >
                <title>{p.label}</title>
                {/* A bigger invisible target, so it's easy to tap. */}
                <circle r="10" fill="transparent" />
                <circle className="plane-focus" r="8.5" fill="none" stroke="var(--accent)" strokeWidth="1.2" opacity={selected ? 1 : 0} />
                <path d={PLANE_PATH} transform={`rotate(${p.heading})`} fill="var(--plane)" opacity={p.catchable ? 1 : 0.45} />
              </g>
            );
          })}
      </svg>
      {/* Below the middle, so the "you" dot stays visible. */}
      {children && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[14%] flex justify-center px-8">
          <div className="pointer-events-auto max-w-[17rem] rounded-xl border border-line bg-surface/95 px-4 py-3 text-center text-sm shadow-sm">
            {children}
          </div>
        </div>
      )}
    </figure>
  );
}
