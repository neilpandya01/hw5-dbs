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
  /** Points from every catch in this group. */
  points: number;
  /** Logo code for an airline group (from its catches), or null. */
  iata: string | null;
  /** The catches themselves, newest first. */
  catches: Catch[];
};

const rank = (r: Rarity) => RARITIES.indexOf(r);

function groupBy(catches: Catch[], keyOf: (c: Catch) => { key: string; name: string; code: string | null }): CollectionGroup[] {
  const groups = new Map<string, CollectionGroup>();
  for (const c of catches) {
    const { key, name, code } = keyOf(c);
    const g = groups.get(key);
    const points = rarityInfo[c.rarity].points;
    if (!g) {
      groups.set(key, {
        key,
        name,
        code,
        count: 1,
        best: c.rarity,
        lastCaughtAt: c.caughtAt,
        points,
        iata: c.airlineIata,
        catches: [c],
      });
    } else {
      g.count += 1;
      g.points += points;
      g.catches.push(c);
      g.iata ??= c.airlineIata;
      if (rank(c.rarity) > rank(g.best)) g.best = c.rarity;
      if (c.caughtAt > g.lastCaughtAt) g.lastCaughtAt = c.caughtAt;
    }
  }
  for (const g of groups.values()) g.catches.sort((a, b) => b.caughtAt.localeCompare(a.caughtAt));
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
  const groups = groupBy(catches, (c) =>
    c.typeCode
      ? { key: c.typeCode, name: c.typeName ?? c.typeCode, code: c.typeCode }
      : { key: "unknown", name: "Unknown type", code: null },
  );
  // Aircraft groups mix airlines, so they don't show one airline's logo.
  return groups.map((g) => ({ ...g, iata: null }));
}

export function totalPoints(catches: Catch[]): number {
  return catches.reduce((sum, c) => sum + rarityInfo[c.rarity].points, 0);
}
