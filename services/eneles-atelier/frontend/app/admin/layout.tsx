import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Eneles admin" },
  robots: { index: false, follow: false },
};

/**
 * The operators' panel. In production it is served at admin.<domain> (proxy.ts maps that host onto this folder); in development it is under /admin.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
