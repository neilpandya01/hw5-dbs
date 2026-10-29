"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useRef } from "react";
import { loadStore } from "@/lib/store";
import { setTokenSource } from "@/lib/supabase";

type GetToken = (options?: { skipCache?: boolean }) => Promise<string | null>;

/** Seconds until a token expires (from its `exp` claim), or 0 if it can't be read. */
function secondsLeft(token: string): number {
  try {
    const { exp } = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return exp ? exp - Date.now() / 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * Clerk's session tokens last about a minute. Realtime asks for a token every 25 seconds and closes the
 * connection, without reconnecting, if that token expires before the next ask. So hand over a token
 * with at least 45 seconds left, asking Clerk for a new one when the cached one is older.
 */
async function freshToken(getToken: GetToken): Promise<string | null> {
  const token = await getToken();
  if (!token || secondsLeft(token) >= 45) return token;
  return getToken({ skipCache: true });
}

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
    setTokenSource(userId ? () => freshToken(tokenFn.current) : null);
    void loadStore(userId ?? null);
    return () => {
      // Signed out (or switched people): nobody else should see their catches or location.
      setTokenSource(null);
      void loadStore(null);
    };
  }, [isLoaded, userId]);

  return null;
}
