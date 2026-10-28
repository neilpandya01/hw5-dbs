"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/Button";
import { PlaneCard, type PlaneDetails } from "@/components/PlaneCard";
import { Radar } from "@/components/Radar";
import { RarityBadge } from "@/components/RarityBadge";
import { CATCH_RANGE_MI, compass, distanceMi, moveBy, offsetMi, type LatLon } from "@/lib/geo";
import { useNearestPlace } from "@/lib/nearestPlace";
import { finishOnboarding } from "@/lib/store";

type Phase = "radar" | "spot" | "card" | "caught";

/** A made-up plane for practice. Practice catches aren't saved. */
const PRACTICE = {
  id: "practice",
  callsign: "DLH430",
  airline: "Lufthansa",
  aircraft: "Boeing 747-8",
  rarity: "rare" as const,
  altitudeFt: 9500,
  heading: 70,
};
/**
 * It flies past a little to one side of you, enters from just outside the ring, and loops if it leaves.
 * Real speed for a plane descending toward an airport: about 430 mph. It reaches the ring in about
 * 12 seconds, then takes about 2.5 minutes to cross it, like a real plane would.
 */
const SPEED_MI_PER_S = 0.12;
const START_MI = 11;
const SIDE_MI = 3;
const LOOP_S = (2 * START_MI) / SPEED_MI_PER_S;

function practicePosition(center: LatLon, seconds: number): LatLon {
  const h = (PRACTICE.heading * Math.PI) / 180;
  const dir = { x: Math.sin(h), y: Math.cos(h) };
  const side = { x: dir.y, y: -dir.x };
  const along = -START_MI + SPEED_MI_PER_S * (seconds % LOOP_S);
  return moveBy(center, dir.x * along + side.x * SIDE_MI, dir.y * along + side.y * SIDE_MI);
}

/** Seconds since `running` turned on, ticking 5 times a second. Frozen in range for reduced motion. */
function useFlightClock(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // No movement: park it inside the ring, so it can still be caught.
      queueMicrotask(() => setSeconds(START_MI / SPEED_MI_PER_S - 6));
      return;
    }
    const start = performance.now();
    const id = setInterval(() => setSeconds((performance.now() - start) / 1000), 200);
    return () => clearInterval(id);
  }, [running]);
  return seconds;
}

/**
 * Step 3: a short practice round on a radar centered on you.
 *   1. Here's your radar: you in the middle, the dashed ring is your catch range.
 *   2. A practice plane flies in. Tap it (or use the list below the radar).
 *   3. Its card: who it is, how rare, how far. Catch works once it's inside the ring.
 *   4. Caught. Start hunting.
 */
export function TutorialStep({
  headingRef,
  center,
  onBack,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  center: LatLon;
  onBack: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("radar");
  const seconds = useFlightClock(phase === "spot" || phase === "card");
  const place = useNearestPlace(center);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const cardHeading = useRef<HTMLHeadingElement>(null);

  // Each new tutorial step moves focus to its text (or the plane's card), so keyboard users follow along.
  const firstPhase = useRef(true);
  useEffect(() => {
    if (firstPhase.current) {
      firstPhase.current = false;
      return;
    }
    (phase === "card" ? cardHeading : stepHeading).current?.focus();
  }, [phase]);

  const position = practicePosition(center, seconds);
  const distance = distanceMi(center, position);
  const { x, y } = offsetMi(center, position);
  const direction = compass((Math.atan2(x, y) * 180) / Math.PI);
  const inRange = distance <= CATCH_RANGE_MI;
  const planeVisible = phase === "spot" || phase === "card";

  const details: PlaneDetails = {
    callsign: PRACTICE.callsign,
    airline: PRACTICE.airline,
    aircraft: PRACTICE.aircraft,
    rarity: PRACTICE.rarity,
    distanceMi: distance,
    direction,
    altitudeFt: PRACTICE.altitudeFt,
  };
  const label = `Practice plane: ${PRACTICE.airline} ${PRACTICE.aircraft}, ${distance.toFixed(1)} miles ${direction}, ${
    inRange ? "in range" : "out of range"
  }`;

  const text: Record<Phase, { title: string; body: string }> = {
    radar: {
      title: "This is your radar.",
      body: `You're the dot in the middle${place ? `, near ${place}` : ""}. The dashed ring is your catch range: ${CATCH_RANGE_MI} miles around you.`,
    },
    spot: {
      title: "A plane is coming.",
      body: "Planes outside the ring are faded: you can't catch them yet. Tap the plane to see who it is.",
    },
    card: {
      title: "Catch it while it's in range.",
      body: "Rarer aircraft are worth more points. Planes keep moving, so don't wait too long.",
    },
    caught: {
      title: "Caught!",
      body: "In the real game, Lufthansa and the Boeing 747-8 would now be in your Collection. This practice catch isn't saved.",
    },
  };

  return (
    <>
      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-ink outline-none">
          Practice catch
        </h2>
        <div aria-live="polite" className="flex flex-col gap-1">
          <h3 ref={stepHeading} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">
            {text[phase].title}
          </h3>
          <p className="text-ink">{text[phase].body}</p>
        </div>

        <Radar
          center={center}
          caption={`Practice radar around you. ${planeVisible ? label : "No planes yet."}`}
          planes={
            planeVisible
              ? [{ id: PRACTICE.id, position, heading: PRACTICE.heading, label, inRange }]
              : []
          }
          selectedId={phase === "card" ? PRACTICE.id : null}
          onSelect={() => setPhase("card")}
        />

        {planeVisible && phase === "spot" && (
          <ul aria-label="Planes on your radar" className="flex flex-col gap-2">
            <li>
              <button
                type="button"
                onClick={() => setPhase("card")}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-bg px-4 py-3 text-left hover:border-control"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-ink">
                    {PRACTICE.airline} · <span className="font-mono">{PRACTICE.callsign}</span>
                  </span>
                  <span className="text-sm text-muted">
                    {distance.toFixed(1)} mi {direction} · {inRange ? "in range" : "out of range"}
                  </span>
                </span>
                <RarityBadge rarity={PRACTICE.rarity} />
              </button>
            </li>
          </ul>
        )}

        {phase === "card" && (
          <PlaneCard
            plane={details}
            headingRef={cardHeading}
            practice
            onCatch={() => setPhase("caught")}
            onClose={() => setPhase("spot")}
          />
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        {phase === "radar" && <Button onClick={() => setPhase("spot")}>Next</Button>}
        {phase === "caught" && <Button onClick={finishOnboarding}>Start hunting</Button>}
        {phase !== "caught" && (
          <Button variant="ghost" onClick={finishOnboarding}>
            Skip practice
          </Button>
        )}
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </>
  );
}
