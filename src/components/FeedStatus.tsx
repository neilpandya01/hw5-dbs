import { ago, VIEW_MI, type Feed } from "@/lib/nearby";

/**
 * How fresh the flight data is, in one line, worded for what's actually on the map (`shown` planes).
 * When flight data is down or the daily limit is reached, this shows nothing: the FeedProblem banner
 * says it instead, once.
 */
export function FeedStatus({ feed, now, shown }: { feed: Feed; now: number; shown: number }) {
  const pill = "inline-flex items-center gap-2 self-start rounded-full border px-3 py-1 text-sm";
  const planes = shown === 1 ? "1 plane" : `${shown} planes`;
  const dot = (color: string, pulse = false) => (
    <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${color} ${pulse ? "animate-pulse motion-reduce:animate-none" : ""}`} />
  );
  switch (feed.status) {
    case "loading":
      return (
        <p className={`${pill} border-line bg-surface text-muted`}>
          {dot("bg-control", true)}
          Loading flights…
        </p>
      );
    case "connecting":
      return (
        <p className={`${pill} border-line bg-surface text-muted`}>
          {dot("bg-warn", true)}
          {shown > 0 ? "Reconnecting… showing the last positions" : "Connecting to live updates…"}
        </p>
      );
    case "starting":
      return (
        <p className={`${pill} border-line bg-surface text-muted`}>
          {dot("bg-ok", true)}
          Looking for planes near you…
        </p>
      );
    case "fresh":
      return (
        <p className={`${pill} border-line bg-surface text-ink`}>
          {dot("bg-ok")}
          <span>
            Live · updated {ago(feed.updatedAt, now)} ·{" "}
            {shown > 0 ? `${planes} within ${VIEW_MI} mi` : `no planes within ${VIEW_MI} mi right now`}
            {feed.pace === "normal" && <span className="text-muted"> · updating every 30 s right now</span>}
            {feed.pace === "slow" && <span className="text-muted"> · updating less often to save today&apos;s limit</span>}
          </span>
        </p>
      );
    case "stale": {
      const gap = ago(feed.updatedAt, now).replace(" ago", "");
      return (
        <p className={`${pill} border-warn bg-warn-soft text-warn`}>
          {dot("bg-warn")}
          {shown > 0
            ? `No update for ${gap} · these positions may be out of date`
            : `No new flight data for ${gap}, so there are no recent planes to show`}
        </p>
      );
    }
    case "down":
    case "limit":
      return null;
  }
}

/** The banner for when planes can't be shown at all. */
export function FeedProblem({ feed }: { feed: Feed }) {
  if (feed.status !== "down" && feed.status !== "limit") return null;
  return (
    <div role="alert" className="flex flex-col gap-1 rounded-xl border border-danger bg-surface px-4 py-3 text-sm">
      <p className="font-medium text-danger">
        {feed.status === "limit" ? "Sky Hunt has reached today's flight data limit." : "Flight data can't be displayed right now."}
      </p>
      <p className="text-ink">
        {feed.status === "limit"
          ? "Flight updates are paused for everyone until the limit resets. Come back later."
          : "Come back later. Your map and collection still work."}
      </p>
    </div>
  );
}
