"use client";

import { useAuth } from "@/lib/auth-context";
import { AuthFrame } from "@/components/essential/auth/AuthFrame";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isInitialized } = useAuth();

  // Only block rendering during the initial auth check.
  // proxy.ts handles server-side redirects for already-authenticated users.
  if (!isInitialized) {
    return null;
  }

  return <AuthFrame>{children}</AuthFrame>;
}
