"use client";

import { useStore } from "@/lib/store";

/** Says plainly when saved data couldn't be read or a change wasn't saved. */
export function StorageBanner() {
  const store = useStore();
  if (!store || store.storage === "ok") return null;
  return (
    <div role="alert" className="rounded-xl border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
      {store.storage === "load-failed"
        ? "Your account couldn't be loaded. Check your connection, then reload the page."
        : "Your last change wasn't saved. Check your connection, then reload the page."}
      {/* While developing, show the technical reason so it can be fixed. Never shown on the live site. */}
      {process.env.NODE_ENV !== "production" && store.problem && (
        <span className="mt-1 block font-mono text-xs break-words">Details: {store.problem}</span>
      )}
    </div>
  );
}
