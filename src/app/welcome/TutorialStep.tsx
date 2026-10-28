"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/Button";
import { PlaneCard } from "@/components/PlaneCard";
import { Radar, type RadarZone } from "@/components/Radar";
import { RarityBadge } from "@/components/RarityBadge";
import { airportsNear, noCatchZoneAt, useAirports } from "@/lib/airports";
import { CATCH_RANGE_MI, compass, distanceMi, moveBy, offsetMi, type LatLon } from "@/lib/geo";
import { useNearestPlace } from "@/lib/nearestPlace";
import { finishOnboarding } from "@/lib/store";

type Phase = "radar" | "spot" | "card" | "caught";

/** A made-up plane for practice, cruising at mid-high altitude. Practice catches aren't saved. */
const PRACTICE = {
  id: "practice",
  callsign: "DLH430",
  airline: "Lufthansa",
  iata: "LH",
  aircraft: "Boeing 747-8",
  rarity: "rare" as const,
  altitudeFt: 24000,
  heading: 70,
};
/**
 * It moves like live flight data: a new position every 10 to 15 seconds, not smoothly.
 * At about 450 mph that's a jump of 1.25 to 1.9 miles per update. It passes a little to one side
 * of you, enters the ring after an update or two, stays catchable for about 80 seconds
 * (about 6 updates), and loops back if it leaves.
 */
const SPEED_MI_PER_S = 0.125;
const START_MI = 6.5;
const SIDE_MI = 1.2;
const LOOP_S = (2 * START_MI) / SPEED_MI_PER_S;
const UPDATE_MIN_S = 10;
const UPDATE_MAX_S = 15;
/** How far out the practice radar reaches: its edge is 1.5 times the catch range. */
const VIEW_MI = CATCH_RANGE_MI * 1.5;

function practicePosition(center: LatLon, seconds: number): LatLon {
  const h = (PRACTICE.heading * Math.PI) / 180;
  const dir = { x: Math.sin(h), y: Math.cos(h) };
  const side = { x: dir.y, y: -dir.x };
  const along = -START_MI + SPEED_MI_PER_S * (seconds % LOOP_S);
  return moveBy(center, dir.x * along + side.x * SIDE_MI, dir.y * along + side.y * SIDE_MI);
}

/**
 * Flight time of the last position update, and when it arrived. While running, a new update
 * lands every 10 to 15 seconds (chosen at random each time, like a real feed).
 */
function useFlightUpdates(running: boolean): { flightSeconds: number; updatedAt: number } {
  const [state, setState] = useState({ flightSeconds: 0, updatedAt: 0 });
  useEffect(() => {
    if (!running) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const wait = UPDATE_MIN_S + Math.random() * (UPDATE_MAX_S - UPDATE_MIN_S);
      timer = setTimeout(() => {
        setState((s) => ({ flightSeconds: s.flightSeconds + wait, updatedAt: Date.now() }));
        schedule();
      }, wait * 1000);
    };
    queueMicrotask(() => setState((s) => (s.updatedAt ? s : { ...s, updatedAt: Date.now() })));
    schedule();
    return () => clearTimeout(timer);
  }, [running]);
  return state;
}

/** "Updated 4 s ago", recounted once a second. */
function useSecondsSince(time: number): number {
  const [now, setNow] = useState(time);
  useEffect(() => {
    if (!time) return;
    queueMicrotask(() => setNow(Date.now()));
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [time]);
  return Math.max(0, Math.round((now - time) / 1000));
}

/**
 * Step 3: a short practice round on a radar centered on you.
 *   1. Here's your radar: you in the middle, the dashed ring is your catch range, grey zones are airports.
 *   2. A practice plane flies in, moving every 10 to 15 seconds. Tap it (or use the list below).
 *   3. Its card: who it is, how rare, how far. Catch works once it's inside the ring, not over an airport.
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
  const [finishing, setFinishing] = useState(false);
  const [finishFailed, setFinishFailed] = useState(false);
  const flying = phase === "spot" || phase === "card";
  const { flightSeconds, updatedAt } = useFlightUpdates(flying);
  const sinceUpdate = useSecondsSince(updatedAt);
  const place = useNearestPlace(center);
  const airports = useAirports();
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

  const position = practicePosition(center, flightSeconds);
  const distance = distanceMi(center, position);
  const { x, y } = offsetMi(center, position);
  const direction = compass((Math.atan2(x, y) * 180) / Math.PI);
  const inRange = distance <= CATCH_RANGE_MI;
  const zone = noCatchZoneAt(airports, position);
  const catchable = inRange && !zone;

  const zones: RadarZone[] = airportsNear(airports, center, VIEW_MI).map((a) => ({
    id: a.code,
    position: a,
    radiusMi: a.zoneMi,
    label: a.code,
  }));

  const status = !inRange ? "out of range" : zone ? `over ${zone.code}, can't be caught` : "in range";
  const label = `Practice plane: ${PRACTICE.airline} ${PRACTICE.aircraft}, ${distance.toFixed(1)} miles ${direction}, ${status}`;

  async function finish() {
    setFinishing(true);
    setFinishFailed(false);
    const ok = await finishOnboarding(); // on success, the welcome flow moves on to the radar
    setFinishing(false);
    if (!ok) setFinishFailed(true);
  }

  const text: Record<Phase, { title: string; body: string }> = {
    radar: {
      title: "This is your radar.",
      body: `You're the dot in the middle${place ? `, near ${place}` : ""}. The dashed ring is your catch range: ${CATCH_RANGE_MI} miles around you. Grey circles are airports: planes there can't be caught.`,
    },
    spot: {
      title: "A plane is coming.",
      body: "Like real flight data, its position updates every 10 to 15 seconds. Faded means it can't be caught yet. Tap the plane to see who it is.",
    },
    card: {
      title: "Catch it while it's in range.",
      body: "Rarer aircraft are worth more points. It keeps moving with each update, so don't wait too long.",
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
          caption={`Practice radar around you. ${flying ? label : "No planes yet."}`}
          zones={zones}
          planes={flying ? [{ id: PRACTICE.id, position, heading: PRACTICE.heading, label, catchable }] : []}
          selectedId={phase === "card" ? PRACTICE.id : null}
          onSelect={() => setPhase("card")}
        />

        {flying && (
          <p className="text-center text-sm text-muted">
            Position updated {sinceUpdate < 2 ? "just now" : `${sinceUpdate} s ago`} · updates every 10–15 seconds
          </p>
        )}

        {phase === "spot" && (
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
                    {distance.toFixed(1)} mi {direction} · {PRACTICE.altitudeFt.toLocaleString()} ft · {status}
                  </span>
                </span>
                <RarityBadge rarity={PRACTICE.rarity} />
              </button>
            </li>
          </ul>
        )}

        {phase === "card" && (
          <PlaneCard
            title={PRACTICE.airline}
            iata={PRACTICE.iata}
            aircraft={PRACTICE.aircraft}
            updated={`Updated ${sinceUpdate < 2 ? "just now" : `${sinceUpdate} s ago`}`}
            block={
              !inRange
                ? `Its last ping was outside your ${CATCH_RANGE_MI}-mile ring. Wait for the next update.`
                : zone
                  ? `It's over the ${zone.code} airport zone. Planes near airports can't be caught.`
                  : null
            }
            headingRef={cardHeading}
            onCatch={() => setPhase("caught")}
            onClose={() => setPhase("spot")}
          />
        )}
      </section>

      {finishFailed && (
        <p role="alert" className="text-sm font-medium text-danger">
          Couldn&apos;t save that to your account. Check your connection and try again.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {phase === "radar" && <Button onClick={() => setPhase("spot")}>Next</Button>}
        {phase === "caught" && (
          <Button onClick={finish} disabled={finishing}>
            Start hunting
          </Button>
        )}
        {phase !== "caught" && (
          <Button variant="ghost" onClick={finish} disabled={finishing}>
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
