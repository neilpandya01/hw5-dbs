"use client";

import { problemMessage, type LocateProblem } from "@/lib/location";
import { Button } from "./Button";
import { Spinner } from "./Page";

/** A location problem: what happened, what to do, and a way to try again. */
export function LocationHelp({
  problem,
  busy = false,
  onRetry,
}: {
  problem: LocateProblem;
  busy?: boolean;
  onRetry: () => void;
}) {
  const { title, help } = problemMessage(problem);
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-xl border border-warn bg-warn-soft px-4 py-3 text-sm">
      <p className="font-medium text-warn">{title}</p>
      <p className="text-ink">{help}</p>
      {problem !== "unsupported" && (
        <Button variant="secondary" size="sm" className="self-start" onClick={onRetry} disabled={busy}>
          {busy ? (
            <>
              <Spinner /> Finding you…
            </>
          ) : (
            "Try again"
          )}
        </Button>
      )}
    </div>
  );
}
