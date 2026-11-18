import { SiteHeader } from "@/components/essential/layout/SiteHeader"
import { SiteFooter } from "@/components/essential/layout/SiteFooter"

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </>
  )
} 