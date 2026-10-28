"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useRef } from "react";
import { loadStore } from "@/lib/store";
import { setTokenSource } from "@/lib/supabase";

/**
 * Connects the signed-in Clerk user to their data. Renders nothing.
 *   - Hands Clerk's session token to Supabase, so row-level security (and Realtime) know who is asking.
 *   - Loads this person's onboarding, location, and catches; forgets them on sign-out.
 */
export function AccountSync() {
  const { isLoaded, userId, getToken } = useAuth();
  // Always ask Clerk for a fresh token; held in a ref so a new function identity doesn't reload everything.
  const tokenFn = useRef(getToken);
  useEffect(() => {
    tokenFn.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded) return;
    setTokenSource(userId ? () => tokenFn.current() : null);
    void loadStore(userId ?? null);
    return () => {
      // Signed out (or switched people): nobody else should see their catches or location.
      setTokenSource(null);
      void loadStore(null);
    };
  }, [isLoaded, userId]);

  return null;
}
