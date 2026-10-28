import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";
import { Brand } from "@/components/Brand";

export default function SignUpPage() {
  return (
    <div className="flex flex-col items-center gap-6 pt-4">
      <Brand />
      {/* Clerk's form reads the URL, so it needs its own Suspense boundary under Cache Components. */}
      <Suspense fallback={<div aria-busy="true" className="h-96 w-full max-w-sm animate-pulse rounded-xl bg-surface" />}>
        <SignUp />
      </Suspense>
    </div>
  );
}
