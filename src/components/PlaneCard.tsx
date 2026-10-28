"use client";

import type { RefObject } from "react";
import { AirlineLogo } from "./AirlineLogo";
import { Button } from "./Button";
import { Spinner } from "./Page";

/**
 * One plane, opened from the map or the list: just the airline (with its logo), the aircraft type,
 * and when its position was last updated, plus Catch. When it can't be caught, the card says why.
 */
export function PlaneCard({
  title,
  iata,
  aircraft,
  updated,
  block,
  busy = false,
  message,
  headingRef,
  onCatch,
  onClose,
}: {
  /** The airline, or "Private plane" / "Unknown aircraft". */
  title: string;
  iata: string | null;
  aircraft: string;
  /** "Updated 12 s ago". */
  updated: string;
  /** Why it can't be caught, or null if it can. */
  block: string | null;
  busy?: boolean;
  /** The result of a catch attempt: success or why it failed. */
  message?: { tone: "ok" | "error"; text: string } | null;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  onCatch: () => void;
  onClose: () => void;
}) {
  return (
    <section aria-labelledby="plane-card-title" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <AirlineLogo iata={iata} />
        <div className="flex min-w-0 flex-col">
          <h2 id="plane-card-title" ref={headingRef} tabIndex={-1} className="truncate text-lg font-semibold text-ink outline-none">
            {title}
          </h2>
          <p className="text-sm text-ink">{aircraft}</p>
          <p className="text-sm text-muted">{updated}</p>
        </div>
      </div>
      {message ? (
        <p role="status" className={`text-sm font-medium ${message.tone === "ok" ? "text-ok" : "text-danger"}`}>
          {message.text}
        </p>
      ) : (
        block && <p className="text-sm text-muted">{block}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {message?.tone !== "ok" && (
          <Button onClick={onCatch} disabled={!!block || busy}>
            {busy ? (
              <>
                <Spinner /> Catching…
              </>
            ) : (
              "Catch"
            )}
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </section>
  );
}
