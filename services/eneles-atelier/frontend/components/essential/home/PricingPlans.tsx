import { Check } from "@/components/icons";
import { Reveal } from "./_shared";
import { PLANS } from "@/lib/plans";

/** Eneles access policy: one free plan, no subscription comparison. */
export function PricingPlans({ className }: { className?: string }) {
  const plan = PLANS[0];
  return (
    <Reveal className={className}>
      <section aria-label="Accès gratuit Eneles" className="mx-auto max-w-3xl rounded-2xl border border-line bg-card p-7 @min-[40rem]:p-9">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 className="text-2xl font-semibold tracking-tight">{plan.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
          </div>
          <span className="text-lg font-semibold">100 % gratuit</span>
        </div>
        <ul className="mt-7 grid gap-3 @min-[40rem]:grid-cols-2">
          {plan.highlights.map((feature) => (
            <li key={feature} className="flex gap-2.5 text-sm">
              <Check className="mt-0.5 size-4 shrink-0 text-foreground/60" aria-hidden />
              <span className="text-muted-foreground">{feature}</span>
            </li>
          ))}
        </ul>
        <p className="mt-7 border-t border-line pt-5 text-xs leading-relaxed text-muted-foreground">
          Les protections techniques nécessaires à la stabilité et à la sécurité restent actives. Certaines fonctions connectées, comme l’IA, nécessitent que leur fournisseur soit configuré.
        </p>
      </section>
    </Reveal>
  );
}
