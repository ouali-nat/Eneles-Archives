import type { Metadata } from "next";
import { HeroSection } from "@/components/essential/home/HeroSection";
import { InstitutionsBand } from "@/components/essential/home/InstitutionsBand";
import { BentoSection } from "@/components/essential/home/BentoSection";
import { TikzCarousel } from "@/components/essential/home/TikzCarousel";
import { TwoWaysSection } from "@/components/essential/home/TwoWaysSection";
import { WorkflowSection } from "@/components/essential/home/WorkflowSection";
import { ComparisonSection } from "@/components/essential/home/ComparisonSection";
import { PricingSection } from "@/components/essential/home/PricingSection";
import { FAQSection } from "@/components/essential/home/FAQSection";
import { CTASection } from "@/components/essential/home/CTASection";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  // The home page is the site, so its title is the name and what it is, without the " - Eneles" every other page adds.
  title: { absolute: "Eneles: the LaTeX workspace for the whole paper" },
  description: siteConfig.description,
  openGraph: {
    title: "Eneles",
    description: siteConfig.description,
    url: siteConfig.url,
    images: [siteConfig.ogImage],
  },
};

/**
 * Homepage.
 *
 * Deliberately a server component: every section that needs interactivity
 * marks itself "use client", so the page shell, copy, and structure are still
 * server-rendered and indexable rather than shipped as an empty div.
 *
 * The order: the hero and its working preview; the wall of figures, edge to edge; what working here feels like, in cards; the same file as source and as a page, nearly edge to edge; the path from first draft to submission; what Eneles includes; pricing; questions; and the invitation to start.
 */
export default function HomePage() {
  return (
    <div className="flex flex-col">
      <HeroSection />
      <InstitutionsBand />
      <TikzCarousel />
      <BentoSection />
      <TwoWaysSection />
      <WorkflowSection />
      <ComparisonSection />
      <PricingSection />
      <FAQSection />
      <CTASection />
    </div>
  );
}
