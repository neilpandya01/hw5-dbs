"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { Button } from "@/components/Button";
import { LocationHelp } from "@/components/LocationHelp";
import { Spinner } from "@/components/Page";
import { locateOnce, type LocateProblem } from "@/lib/location";
import { useNearestPlace } from "@/lib/nearestPlace";
import { saveLocation, type SavedLocation } from "@/lib/store";

/**
 * Step 2: share your location. Required: Sky Hunt only works around where you are.
 * If the browser blocks it or can't find you, say why and how to fix it, with Try again.
 * Coming Back to this step after sharing shows where we have you, with Continue.
 */
export function LocationStep({
  headingRef,
  saved,
  onDone,
  onBack,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  saved: SavedLocation | null;
  onDone: () => void;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<LocateProblem | null>(null);
  // The browser found you, but your account couldn't save it.
  const [saveFailed, setSaveFailed] = useState(false);
  const place = useNearestPlace(saved);

  // Pages you leave are hidden, not unmounted: never come back to a stuck "Finding you…".
  useLayoutEffect(() => () => setBusy(false), []);

  async function share() {
    setBusy(true);
    setSaveFailed(false);
    const result = await locateOnce();
    if (!result.ok) {
      setBusy(false);
      setProblem(result.problem);
      return;
    }
    setProblem(null);
    const saved = await saveLocation(result.position);
    setBusy(false);
    if (saved) onDone();
    else setSaveFailed(true);
  }

  return (
    <>
      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-ink outline-none">
          Where are you hunting from?
        </h2>
        <p className="text-ink">
          Sky Hunt shows the planes flying near you, so it needs your location to work. Your browser will ask first.
        </p>
        <p className="text-sm text-muted">
          We only save it rounded to about 1 km, never your exact spot, and only update it when you&apos;ve moved a
          couple of kilometers.
        </p>
        {saved && !problem && (
          <p className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
            Location shared: {place ? `near ${place}` : "your location"}.
          </p>
        )}
        {problem && <LocationHelp problem={problem} busy={busy} onRetry={share} />}
        {saveFailed && (
          <div role="alert" className="flex flex-col gap-1 rounded-xl border border-danger px-4 py-3 text-sm">
            <p className="font-medium text-danger">We found you, but couldn&apos;t save it to your account.</p>
            <p className="text-ink">Check your connection, reload the page, and try again. If it keeps happening, your account may not be connected to the database yet.</p>
          </div>
        )}
      </section>
      <div className="flex flex-wrap gap-2">
        {saved && !problem ? (
          <>
            <Button onClick={onDone}>Continue</Button>
            <Button variant="secondary" onClick={share} disabled={busy}>
              {busy ? (
                <>
                  <Spinner /> Finding you…
                </>
              ) : (
                "Update my location"
              )}
            </Button>
          </>
        ) : (
          !problem && (
            <Button onClick={share} disabled={busy} aria-live="polite">
              {busy ? (
                <>
                  <Spinner /> Finding you…
                </>
              ) : (
                "Share my location"
              )}
            </Button>
          )
        )}
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </>
  );
}
