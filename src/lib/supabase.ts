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
