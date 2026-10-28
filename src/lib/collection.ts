import { RARITIES, rarityInfo, type Rarity } from "./rarity";
import type { Catch } from "./store";

// Turns a list of catches into the Collection's two views: by airline and by aircraft type.

export type CollectionGroup = {
  key: string;
  name: string;
  /** ICAO code shown next to the name: "UAL", "B788". */
  code: string | null;
  count: number;
  /** The rarest catch in this group. */
  best: Rarity;
  lastCaughtAt: string;
};

const rank = (r: Rarity) => RARITIES.indexOf(r);

function groupBy(catches: Catch[], keyOf: (c: Catch) => { key: string; name: string; code: string | null }): CollectionGroup[] {
  const groups = new Map<string, CollectionGroup>();
  for (const c of catches) {
    const { key, name, code } = keyOf(c);
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { key, name, code, count: 1, best: c.rarity, lastCaughtAt: c.caughtAt });
    } else {
      g.count += 1;
      if (rank(c.rarity) > rank(g.best)) g.best = c.rarity;
      if (c.caughtAt > g.lastCaughtAt) g.lastCaughtAt = c.caughtAt;
    }
  }
  // Rarest first, then most caught, then A to Z.
  return [...groups.values()].sort(
    (a, b) => rank(b.best) - rank(a.best) || b.count - a.count || a.name.localeCompare(b.name),
  );
}

export function byAirline(catches: Catch[]): CollectionGroup[] {
  return groupBy(catches, (c) =>
    c.airlineCode
      ? { key: c.airlineCode, name: c.airlineName ?? c.airlineCode, code: c.airlineCode }
      : { key: "private", name: "Private and other", code: null },
  );
}

export function byAircraft(catches: Catch[]): CollectionGroup[] {
  return groupBy(catches, (c) =>
    c.typeCode
      ? { key: c.typeCode, name: c.typeName ?? c.typeCode, code: c.typeCode }
      : { key: "unknown", name: "Unknown type", code: null },
  );
}

export function totalPoints(catches: Catch[]): number {
  return catches.reduce((sum, c) => sum + rarityInfo[c.rarity].points, 0);
}
