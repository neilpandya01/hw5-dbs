"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { PageSkeleton } from "@/components/Page";
import { useStore, type SavedLocation } from "@/lib/store";
import { LocationStep } from "./LocationStep";
import { OverviewStep } from "./OverviewStep";
import { TutorialStep } from "./TutorialStep";

const STEPS = ["overview", "location", "tutorial"] as const;
type Step = (typeof STEPS)[number];

/**
 * The first visit, required for anyone new:
 *   1. /welcome?step=overview   What Sky Hunt is and how the game works.
 *   2. /welcome?step=location   Share your location (required; the game is built around it).
 *   3. /welcome?step=tutorial   Practice catching a plane on a radar centered on you.
 * Then the radar (/). Each step has its own URL, so Back and the browser's Back button go to the
 * previous step. Opening or reloading /welcome lands on the step you'd reached; after that the URL
 * decides, but never past an unanswered step (no tutorial without a location).
 */
export function WelcomeFlow() {
  const store = useStore();
  const router = useRouter();
  const requested = useSearchParams().get("step");
  const onboarded = !!store?.data.onboarded;
  // The first time this page shows (open or reload), go to the step reached, whatever the URL says.
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    if (onboarded) router.replace("/");
  }, [onboarded, router]);

  if (!store || onboarded) return <PageSkeleton label="Loading" />;

  const location = store.data.location;
  // Where they'd reached: the first step still to answer. The overview has nothing to save, so
  // someone already past it (by URL) stays on the location step.
  const reached: Step = location ? "tutorial" : requested === "location" || requested === "tutorial" ? "location" : "overview";
  const asked = STEPS.includes(requested as Step) ? (requested as Step) : null;
  let step: Step = !arrived || !asked ? reached : asked;
  if (step === "tutorial" && !location) step = "location";

  return (
    <Arrive step={step} urlStep={asked} onArrived={setArrived}>
      <Flow step={step} location={location} />
    </Arrive>
  );
}

/** Keeps the URL in step with what's shown (replace, so Back isn't cluttered), and marks arrival as done. */
function Arrive({
  step,
  urlStep,
  onArrived,
  children,
}: {
  step: Step;
  urlStep: Step | null;
  onArrived: (arrived: true) => void;
  children: ReactNode;
}) {
  const router = useRouter();
  useLayoutEffect(() => {
    onArrived(true);
    if (urlStep !== step) router.replace(stepHref(step), { scroll: false });
  }, [step, urlStep, onArrived, router]);
  return children;
}

function stepHref(step: Step) {
  return `/welcome?step=${step}`;
}

function Flow({ step, location }: { step: Step; location: SavedLocation | null }) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  // Moving between steps puts focus on the new heading, so keyboard and screen reader users land in the right place.
  useEffect(() => {
    if (first.current) first.current = false;
    else heading.current?.focus();
  }, [step]);

  function go(next: Step) {
    router.push(stepHref(next), { scroll: false });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Welcome to Sky Hunt</h1>
        <p className="text-sm font-medium text-muted" aria-live="polite">
          Step {STEPS.indexOf(step) + 1} of {STEPS.length}
        </p>
      </div>
      {step === "overview" && <OverviewStep headingRef={heading} onDone={() => go("location")} />}
      {step === "location" && (
        <LocationStep headingRef={heading} saved={location} onDone={() => go("tutorial")} onBack={() => go("overview")} />
      )}
      {step === "tutorial" && location && (
        <TutorialStep key={`${location.lat},${location.lon}`} headingRef={heading} center={location} onBack={() => go("location")} />
      )}
    </div>
  );
}
