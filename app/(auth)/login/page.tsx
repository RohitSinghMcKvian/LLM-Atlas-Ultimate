import * as React from "react";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * `useSearchParams` inside `AuthForm` opts the tree into client-side rendering,
 * which Next requires a Suspense boundary for. The fallback is deliberately
 * nothing: the shell around it — the plate, the field, the panel — is already
 * painted, so a spinner here would only flash inside a page that already looks
 * finished.
 */
export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <AuthForm mode="login" />
    </React.Suspense>
  );
}
