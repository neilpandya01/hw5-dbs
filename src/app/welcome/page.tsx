import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/Page";
import { WelcomeFlow } from "./WelcomeFlow";

export const metadata: Metadata = { title: "Welcome · Sky Hunt" };

export default function WelcomePage() {
  // The step lives in the URL (?step=location), so the flow sits behind Suspense.
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WelcomeFlow />
    </Suspense>
  );
}
