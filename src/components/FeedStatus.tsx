import { ago, type Feed } from "@/lib/nearby";

/**
 * How fresh the flight data is, in one line. When flight data is down or the daily limit is reached,
 * this shows nothing: the FeedProblem banner says it instead, once.
 */
export function FeedStatus({ feed, now }: { feed: Feed; now: number }) {
  const pill = "inline-flex items-center gap-2 self-start rounded-full border px-3 py-1 text-sm";
  switch (feed.status) {
    case "loading":
      return (
        <p className={`${pill} border-line bg-surface text-muted`}>
          <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-control" />
          Loading flights…
        </p>
      );
    case "fresh":
      return (
        <p className={`${pill} border-line bg-surface text-ink`}>
          <span aria-hidden="true" className="size-2 rounded-full bg-ok" />
          Live · updated {ago(feed.updatedAt, now)}
          {feed.slow && <span className="text-muted">· every minute today</span>}
        </p>
      );
    case "stale":
      return (
        <p className={`${pill} border-warn bg-warn-soft text-warn`}>
          <span aria-hidden="true" className="size-2 rounded-full bg-warn" />
          Flight data is {ago(feed.updatedAt, now).replace(" ago", "")} old
        </p>
      );
    case "down":
    case "limit":
      return null;
  }
}

/** The banner for when planes can't be shown at all. */
export function FeedProblem({ feed }: { feed: Feed }) {
  if (feed.status !== "down" && feed.status !== "limit") return null;
  const back =
    feed.status === "limit" && feed.resumeAt
      ? ` Updates should be back around ${new Date(feed.resumeAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`
      : "";
  return (
    <div role="alert" className="flex flex-col gap-1 rounded-xl border border-danger bg-surface px-4 py-3 text-sm">
      <p className="font-medium text-danger">
        {feed.status === "limit" ? "Sky Hunt has used today's flight data limit." : "Flight data can't be displayed right now."}
      </p>
      <p className="text-ink">
        {feed.status === "limit"
          ? `Flight updates are paused for everyone until the limit resets. Come back later.${back}`
          : "Come back later. Your map and collection still work."}
      </p>
    </div>
  );
}
