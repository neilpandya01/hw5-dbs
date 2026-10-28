"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// One Supabase client for the browser. It sends the signed-in person's Clerk session token,
// so Supabase knows who is asking (auth.jwt()->>'sub') and row-level security only lets
// them touch their own rows. Only the publishable key is used here; never the secret key.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** Set by AccountSync once Clerk has loaded: returns the current session token. */
let getToken: (() => Promise<string | null>) | null = null;

export function setTokenSource(source: (() => Promise<string | null>) | null) {
  getToken = source;
}

let client: SupabaseClient | null = null;

/** null when the Supabase environment variables are missing, so callers can show a clear error. */
export function supabase(): SupabaseClient | null {
  if (!url || !key) return null;
  client ??= createClient(url, key, {
    accessToken: async () => (getToken ? getToken() : null),
  });
  return client;
}

/**
 * For troubleshooting while developing: what Clerk's session token tells Supabase. Supabase only
 * treats you as signed in when the token has role "authenticated" (added by Clerk's Supabase
 * integration) and its issuer is the Clerk domain set in Supabase's third-party auth.
 * Shows only those two claims, never the token itself.
 */
export async function describeToken(): Promise<string> {
  if (!getToken) return "no Clerk token source (not signed in yet)";
  const token = await getToken().catch(() => null);
  if (!token) return "Clerk returned no session token";
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { role?: string; iss?: string };
    return `Clerk token: role=${payload.role ?? "MISSING"}, issuer=${payload.iss ?? "?"}`;
  } catch {
    return "Clerk's token couldn't be read";
  }
}
