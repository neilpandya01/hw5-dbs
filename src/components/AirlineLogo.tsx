"use client";

import { useState } from "react";

// Airline logos from pics.avs.io (free, no key), by IATA code. Each logo is downloaded once and then
// comes from the browser's cache. The radar preloads the logos of every airline on the map, so opening
// a plane shows its logo right away instead of waiting for the download.

const logoUrl = (iata: string) => `https://pics.avs.io/200/80/${encodeURIComponent(iata)}.png`;

const requested = new Set<string>();
const loaded = new Set<string>();
const failed = new Set<string>();

/** Start downloading these airlines' logos in the background (each only once). */
export function preloadLogos(iatas: Iterable<string | null>) {
  for (const iata of iatas) {
    if (!iata || requested.has(iata)) continue;
    requested.add(iata);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => loaded.add(iata);
    img.onerror = () => failed.add(iata);
    img.src = logoUrl(iata);
  }
}

/**
 * An airline's logo. Until it's ready (or if there's no code, or it fails), the airline's code shows
 * in its place, so the space never sits empty. Decorative: the name is always written next to it.
 */
export function AirlineLogo({ iata, size = "md" }: { iata: string | null; size?: "sm" | "md" }) {
  // A fresh logo per airline, so switching planes never shows the previous airline's state.
  return <Logo key={iata ?? "none"} iata={iata} size={size} />;
}

function Logo({ iata, size }: { iata: string | null; size: "sm" | "md" }) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">(() =>
    !iata || failed.has(iata) ? "failed" : loaded.has(iata) ? "loaded" : "loading",
  );
  const box = size === "sm" ? "h-6 w-14" : "h-10 w-24";
  return (
    <span aria-hidden="true" className={`${box} relative inline-flex shrink-0 overflow-hidden rounded-md`}>
      {state !== "loaded" && (
        <span className="absolute inset-0 flex items-center justify-center bg-accent-soft text-xs font-semibold text-accent">
          {iata ?? "✈"}
        </span>
      )}
      {iata && state !== "failed" && (
        // A plain <img>: the logos come from another site and are tiny; Next's image optimizer isn't needed.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl(iata)}
          alt=""
          decoding="async"
          onLoad={() => {
            loaded.add(iata);
            setState("loaded");
          }}
          onError={() => {
            failed.add(iata);
            setState("failed");
          }}
          className={`absolute inset-0 size-full bg-white object-contain p-0.5 transition-opacity duration-150 motion-reduce:transition-none ${
            state === "loaded" ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </span>
  );
}
