import type { Metadata } from "next";

export const metadata: Metadata = { title: "Accès Eneles" };

export default function AccessLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
