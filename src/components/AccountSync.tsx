"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
import { loadStore } from "@/lib/store";

/**
 * Connects the signed-in Clerk user to their data. Renders nothing.
 * Loads this person's onboarding, location, and catches on sign-in; forgets them on sign-out.
 * (When Supabase is connected, this is also where Clerk's session token is handed to it.)
 */
export function AccountSync() {
  const { isLoaded, userId } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    loadStore(userId ?? null);
    // Signed out (or switched people): nobody else should see their catches or location.
    return () => loadStore(null);
  }, [isLoaded, userId]);

  return null;
}
