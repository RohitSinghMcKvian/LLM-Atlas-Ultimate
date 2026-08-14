import * as React from "react";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Create an account" };

export default function RegisterPage() {
  return (
    <React.Suspense fallback={null}>
      <AuthForm mode="register" />
    </React.Suspense>
  );
}
