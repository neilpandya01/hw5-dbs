"use client";

import { useStore } from "@/lib/store";

/** Says plainly when saved data couldn't be read or a change wasn't saved. */
export function StorageBanner() {
  const store = useStore();
  if (!store || store.storage === "ok") return null;
  return (
    <div role="alert" className="rounded-xl border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
      {store.storage === "load-failed"
        ? "Your saved progress couldn't be loaded on this device. Reload the page to try again."
        : "Your last change wasn't saved. This browser may be blocking storage (private window). Reload to try again."}
    </div>
  );
}
