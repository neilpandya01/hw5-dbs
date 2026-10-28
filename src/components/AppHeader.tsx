"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import type { ReactNode } from "react";
import { isNewUser, useStore } from "@/lib/store";
import { Brand } from "./Brand";

/**
 *   ┌ ✈ Sky Hunt                     (account) ┐   (pinned)
 *   └ Radar        Collection                  ┘   (pinned)
 * Hidden while saved data loads. During onboarding only the name and account menu show,
 * so someone new can still sign out.
 */
export function AppHeader({ nav }: { nav: ReactNode }) {
  const store = useStore();
  if (!store) return null;
  const onboarding = isNewUser(store);

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-bg/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-xl flex-col px-4">
        <div className="flex min-h-16 items-center justify-between gap-4">
          {onboarding ? (
            <Brand />
          ) : (
            <Link href="/" aria-label="Sky Hunt, go to the radar">
              <Brand />
            </Link>
          )}
          <UserButton />
        </div>
        {!onboarding && nav}
      </div>
    </header>
  );
}
