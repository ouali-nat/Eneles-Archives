import type { Metadata } from "next";
import { Check } from "@/components/icons";
import { PricingPlans } from "@/components/essential/home/PricingPlans";
import { FAQSection } from "@/components/essential/home/FAQSection";
import { Reveal } from "@/components/essential/home/_shared";
import { SitePageHeader } from "@/components/essential/layout/SitePageHeader";
import { COMPARISON } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Accès gratuit",
  description: "Toutes les fonctionnalités d’Eneles sont accessibles gratuitement à chaque membre.",
};

export default function PricingPage() {
  return (
    <div>
      <SitePageHeader title="Tout Eneles, gratuitement" description="Un seul espace, les mêmes outils pour tous. Aucun abonnement à souscrire." className="pb-0 @min-[40rem]:pb-0" />
      <section><div className="container pb-16 @min-[40rem]:pb-20"><PricingPlans className="mt-10" /></div></section>
      <section className="py-16 @min-[40rem]:py-20">
        <div className="container">
          <Reveal>
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-2xl font-semibold tracking-tight">Ce qui est inclus</h2>
              <p className="mt-3 text-sm text-muted-foreground">Toutes les fonctionnalités du produit sont ouvertes. Les garde-fous techniques protègent la disponibilité collective.</p>
            </div>
          </Reveal>
          <div className="mx-auto mt-8 max-w-3xl overflow-hidden rounded-2xl border">
            <table className="w-full text-sm"><thead><tr className="border-b bg-surface/30"><th scope="col" className="px-5 py-3 text-start font-semibold">Fonctionnalité</th><th scope="col" className="px-4 py-3 text-center font-semibold">Accès Eneles</th></tr></thead>
              <tbody>{COMPARISON.map((row) => <tr key={row.feature} className="border-b last:border-0"><th scope="row" className="px-5 py-3 text-start font-medium">{row.feature}</th><td className="px-4 py-3 text-center">{row.free === true ? <Check className="mx-auto h-4 w-4" aria-label="Inclus" /> : row.free === false ? "—" : <span className="text-muted-foreground">{row.free}</span>}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </section>
      <FAQSection />
    </div>
  );
}
