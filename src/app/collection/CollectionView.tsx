"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { AirlineLogo } from "@/components/AirlineLogo";
import { ButtonLink } from "@/components/Button";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/Page";
import { RarityBadge } from "@/components/RarityBadge";
import { byAircraft, byAirline, totalPoints, type CollectionGroup } from "@/lib/collection";
import { rarityInfo } from "@/lib/rarity";
import { useStore } from "@/lib/store";

type View = "airlines" | "aircraft";
const VIEWS: { id: View; label: string }[] = [
  { id: "airlines", label: "Airlines" },
  { id: "aircraft", label: "Aircraft" },
];

/** Everything you've caught, two ways: by airline, and by aircraft type. */
export function CollectionView() {
  const store = useStore();
  const [view, setView] = useState<View>("airlines");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  if (!store) return <PageSkeleton label="Loading your collection" />;

  const catches = store.data.catches;
  const airlines = byAirline(catches);
  const aircraft = byAircraft(catches);
  const groups = view === "airlines" ? airlines : aircraft;

  // Arrow keys move between the two tabs, as in any tab list.
  function onKey(e: KeyboardEvent, i: number) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : -1) + VIEWS.length) % VIEWS.length;
    setView(VIEWS[next].id);
    tabs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Collection" subtitle="Every airline and aircraft you've caught." />

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Planes caught", catches.length],
          ["Airlines", airlines.filter((g) => g.code).length],
          ["Aircraft types", aircraft.filter((g) => g.code).length],
          ["Points", totalPoints(catches)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-surface px-3 py-2">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="text-xl font-semibold text-ink">{value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>

      <div role="tablist" aria-label="Collection view" className="flex rounded-lg border border-line bg-surface p-1">
        {VIEWS.map((v, i) => {
          const selected = v.id === view;
          return (
            <button
              key={v.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${v.id}`}
              aria-selected={selected}
              aria-controls="collection-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setView(v.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={`min-h-10 flex-1 rounded-md text-sm font-medium transition-colors ${
                selected ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
              }`}
            >
              {v.label} ({(v.id === "airlines" ? airlines : aircraft).length})
            </button>
          );
        })}
      </div>

      <div id="collection-panel" role="tabpanel" aria-labelledby={`tab-${view}`}>
        {groups.length === 0 ? (
          <EmptyState title={view === "airlines" ? "No airlines yet." : "No aircraft yet."}>
            <p>
              Catch planes on the radar and they&apos;ll show up here, grouped by{" "}
              {view === "airlines" ? "airline" : "aircraft type"}.
            </p>
            <ButtonLink href="/" size="sm">
              Go to the radar
            </ButtonLink>
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {groups.map((g) => (
              <GroupRow key={`${view}-${g.key}`} group={g} view={view} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * One airline or aircraft type. Press it to see each catch in it: the flight, the other half of the
 * pair (its aircraft, or its airline), rarity, points, and when. The header row totals the points.
 */
function GroupRow({ group, view }: { group: CollectionGroup; view: View }) {
  const [open, setOpen] = useState(false);
  const last = new Date(group.lastCaughtAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const detailsId = `catches-${view}-${group.key}`;
  return (
    <li className="rounded-xl border border-line bg-surface">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left hover:bg-bg"
      >
        {view === "airlines" && <AirlineLogo iata={group.iata} size="sm" />}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium text-ink">
            {group.name}
            {group.code && <span className="ml-2 font-mono text-sm text-muted">{group.code}</span>}
          </span>
          <span className="text-sm text-muted">
            Caught {group.count} time{group.count === 1 ? "" : "s"} · {group.points.toLocaleString()} points · last on {last}
          </span>
        </span>
        <RarityBadge rarity={group.best} />
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={`size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          fill="currentColor"
        >
          <path d="M5.2 7.6a.75.75 0 0 1 1.06.02L10 11.6l3.74-3.98a.75.75 0 1 1 1.1 1.02l-4.3 4.57a.75.75 0 0 1-1.08 0L5.18 8.66a.75.75 0 0 1 .02-1.06Z" />
        </svg>
      </button>
      {open && (
        <ul id={detailsId} className="flex flex-col divide-y divide-line border-t border-line">
          {group.catches.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-ink">
                  {view === "airlines" ? (c.typeName ?? c.typeCode ?? "Unknown type") : (c.airlineName ?? "Unknown airline")}
                  {c.callsign && <span className="ml-2 font-mono text-muted">{c.callsign}</span>}
                </span>
                <span className="text-muted">
                  {new Date(c.caughtAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <RarityBadge rarity={c.rarity} />
                <span className="w-16 text-right font-medium text-ink">+{rarityInfo[c.rarity].points} pts</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
