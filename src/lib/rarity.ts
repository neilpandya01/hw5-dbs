// Rarity tiers for catches. Each tier is always shown with its name, never by color alone.
// Which aircraft land in which tier is decided by the worker (worker/src/aircraft.js) and saved with each sighting.

export type Rarity = "common" | "uncommon" | "rare" | "legendary";

export const RARITIES: Rarity[] = ["common", "uncommon", "rare", "legendary"];

export const rarityInfo: Record<Rarity, { label: string; points: number; text: string; dot: string }> = {
  common: { label: "Common", points: 10, text: "text-tier-common", dot: "bg-tier-common" },
  uncommon: { label: "Uncommon", points: 25, text: "text-tier-uncommon", dot: "bg-tier-uncommon" },
  rare: { label: "Rare", points: 60, text: "text-tier-rare", dot: "bg-tier-rare" },
  legendary: { label: "Legendary", points: 150, text: "text-tier-legendary", dot: "bg-tier-legendary" },
};
