"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/", label: "Radar", match: (p: string) => p === "/" },
  { href: "/collection", label: "Collection", match: (p: string) => p.startsWith("/collection") },
];

/** The two views, as tabs: where you are (aria-current) and one tap back to the radar. */
export function Nav() {
  return <NavTabs pathname={usePathname()} />;
}

/** With no pathname it renders the tabs without a current one: the fallback while the URL is being read. */
export function NavTabs({ pathname }: { pathname?: string }) {
  return (
    <nav aria-label="Main" className="flex">
      {tabs.map((t) => {
        const current = pathname !== undefined && t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={current ? "page" : undefined}
            className={`flex min-h-11 flex-1 items-center justify-center border-b-2 text-sm font-medium transition-colors ${
              current ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
