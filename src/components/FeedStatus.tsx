/**
 * How fresh the flight data is. For now the flight feed isn't connected, so it always says so.
 * When the worker is running, this becomes: loading, fresh ("Updated 12 s ago"), stale
 * (several missed runs), or down (the worker's last run failed), read from the `runs` table.
 */
export type FeedState = { status: "not-connected" };

export function FeedStatus({ state }: { state: FeedState }) {
  switch (state.status) {
    case "not-connected":
      return (
        <p className="inline-flex items-center gap-2 self-start rounded-full border border-line bg-surface px-3 py-1 text-sm text-muted">
          <span aria-hidden="true" className="size-2 rounded-full bg-control" />
          Live flights: not connected yet
        </p>
      );
  }
}
