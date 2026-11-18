import type { Metadata } from "next";
import { cookies } from "next/headers";
import { StatusPage } from "@/components/essential/status/StatusPage";

export const metadata: Metadata = { title: "Page not found" };

/** Any address that matches no route, signed in or not. A signed-in reader is sent on to the dashboard rather than the home page; the page knows from the marker cookie the sign-in sets beside its session. */
export default async function NotFound() {
  const signedIn = (await cookies()).get("texer_signed_in")?.value === "1";
  return (
    <StatusPage
      kind="not-found"
      actions={[signedIn ? { label: "Go to the dashboard", href: "/dashboard" } : { label: "Go home", href: "/" }, { label: "Go back", back: true, fallback: signedIn ? "/dashboard" : "/" }]}
    />
  );
}
