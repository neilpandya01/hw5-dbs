import { rarityInfo, type Rarity } from "@/lib/rarity";

/** "● Rare": the tier's name always shows, so color is never the only signal. */
export function RarityBadge({ rarity }: { rarity: Rarity }) {
  const tier = rarityInfo[rarity];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-xs font-semibold ${tier.text}`}>
      <span aria-hidden="true" className={`size-2 rounded-full ${tier.dot}`} />
      {tier.label}
    </span>
  );
}
