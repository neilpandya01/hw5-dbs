"use client";

import { useState } from "react";

/**
 * An airline's logo, from pics.avs.io (free, no key) by IATA code. If there's no code or the image
 * fails, a plain badge with the code takes its place. Decorative: the name is always written next to it.
 */
export function AirlineLogo({ iata, size = "md" }: { iata: string | null; size?: "sm" | "md" }) {
  const [failed, setFailed] = useState(false);
  const box = size === "sm" ? "h-6 w-14" : "h-10 w-24";
  if (!iata || failed) {
    return (
      <span aria-hidden="true" className={`${box} inline-flex shrink-0 items-center justify-center rounded-md bg-accent-soft text-xs font-semibold text-accent`}>
        {iata ?? "✈"}
      </span>
    );
  }
  return (
    // A plain <img>: the logos come from another site and are tiny; Next's image optimizer isn't needed.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://pics.avs.io/200/80/${encodeURIComponent(iata)}.png`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${box} shrink-0 rounded-md bg-white object-contain p-0.5`}
    />
  );
}
