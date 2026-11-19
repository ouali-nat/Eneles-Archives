import type { Metadata } from "next";

// This page is a client component, which cannot name itself; the title is set here.
export const metadata: Metadata = { title: "Statistics" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
