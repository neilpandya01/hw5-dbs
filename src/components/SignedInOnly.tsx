"use client";

import { useAuth } from "@clerk/nextjs";
import type { ReactNode } from "react";

/**
 * App-wide pieces (header, rollover, onboarding redirect) only make sense once someone is signed in.
 * On /sign-in and /sign-up they'd show saved data or redirect away, so they stay hidden there.
 */
export function SignedInOnly({ children }: { children: ReactNode }) {
  const { isSignedIn } = useAuth();
  return isSignedIn ? children : null;
}
