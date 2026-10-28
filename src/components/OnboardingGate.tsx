"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { isNewUser, useStore } from "@/lib/store";

/**
 * Onboarding is required: someone new who opens any page is sent to /welcome first.
 * /welcome itself sends people who have finished on to the radar. Renders nothing.
 */
export function OnboardingGate() {
  const store = useStore();
  const pathname = usePathname();
  const router = useRouter();
  const mustOnboard = !!store && isNewUser(store) && pathname !== "/welcome";

  useEffect(() => {
    if (mustOnboard) router.replace("/welcome");
  }, [mustOnboard, router]);

  return null;
}
