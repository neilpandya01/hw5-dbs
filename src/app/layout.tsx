import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { AccountSync } from "@/components/AccountSync";
import { AppHeader } from "@/components/AppHeader";
import { Nav, NavTabs } from "@/components/Nav";
import { OnboardingGate } from "@/components/OnboardingGate";
import { SignedInOnly } from "@/components/SignedInOnly";
import { StorageBanner } from "@/components/StorageBanner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sky Hunt",
  description: "Catch the planes flying over you, and collect every airline and aircraft.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up">
          {/* First thing a keyboard user reaches: jump past the header and tabs to the page itself. */}
          <a
            href="#main"
            className="sr-only z-30 rounded-lg bg-ink px-4 py-2 text-bg focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
          >
            Skip to main content
          </a>
          <SignedInOnly>
            {/* Nav reads the URL, so it needs its own Suspense boundary under Cache Components. */}
            <AppHeader
              nav={
                <Suspense fallback={<NavTabs />}>
                  <Nav />
                </Suspense>
              }
            />
          </SignedInOnly>
          <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 pt-6 pb-24 outline-none">
            <SignedInOnly>
              <AccountSync />
              <StorageBanner />
              {/* Reads the URL, so it needs its own Suspense boundary under Cache Components. */}
              <Suspense fallback={null}>
                <OnboardingGate />
              </Suspense>
            </SignedInOnly>
            {children}
          </main>
        </ClerkProvider>
      </body>
    </html>
  );
}
