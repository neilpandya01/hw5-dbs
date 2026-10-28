"use client";

import type { RefObject } from "react";
import { Button } from "@/components/Button";
import { CATCH_RANGE_MI } from "@/lib/geo";

/** Step 1: what Sky Hunt is and how the game works, before asking for anything. */
export function OverviewStep({
  headingRef,
  onDone,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  onDone: () => void;
}) {
  return (
    <>
      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-ink outline-none">
          Catch the planes flying over you.
        </h2>
        <p className="text-ink">Sky Hunt turns the real planes above you into a collection game.</p>
        <ol className="flex flex-col gap-3 text-ink">
          {[
            `Watch your radar. Real flights show up as they come within ${CATCH_RANGE_MI} miles of you.`,
            "Catch a plane before it flies out of range.",
            "Collect every airline and aircraft type. Rare ones, like a 747 or an A380, are worth more.",
          ].map((line, i) => (
            <li key={line} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent"
              >
                {i + 1}
              </span>
              {line}
            </li>
          ))}
        </ol>
        <p className="text-sm text-muted">Your catches are saved to your account.</p>
      </section>
      <Button className="self-start" onClick={onDone}>
        Get started
      </Button>
    </>
  );
}
