import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// The only pages a signed-out visitor may open. Everything else needs an account.
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(
  async (auth, req) => {
    // Signed-out page visits are redirected to /sign-in; API calls get a 404 instead.
    if (!isPublicRoute(req)) await auth.protect();
  },
  { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
);

export const config = {
  matcher: [
    // Every page, but not Next.js internals or static files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
