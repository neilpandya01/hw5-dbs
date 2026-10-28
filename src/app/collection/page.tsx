import type { Metadata } from "next";
import { CollectionView } from "./CollectionView";

export const metadata: Metadata = { title: "Collection · Sky Hunt" };

export default function CollectionPage() {
  return <CollectionView />;
}
