"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { ButtonLink } from "@/components/Button";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/Page";
import { RarityBadge } from "@/components/RarityBadge";
import { byAircraft, byAirline, totalPoints, type CollectionGroup } from "@/lib/collection";
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
              <GroupRow key={g.key} group={g} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function GroupRow({ group }: { group: CollectionGroup }) {
  const last = new Date(group.lastCaughtAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-ink">
          {group.name}
          {group.code && <span className="ml-2 font-mono text-sm text-muted">{group.code}</span>}
        </span>
        <span className="text-sm text-muted">
          Caught {group.count} time{group.count === 1 ? "" : "s"} · last on {last}
        </span>
      </div>
      <RarityBadge rarity={group.best} />
    </li>
  );
}
