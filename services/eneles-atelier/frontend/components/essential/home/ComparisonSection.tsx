import { Check } from "@/components/icons";
import { Reveal, SectionHeading } from "./_shared";

const FEATURES = [
  "Édition LaTeX et mode visuel",
  "Compilation PDF avec pdfLaTeX, XeLaTeX et LuaLaTeX",
  "Projets partagés, commentaires et suggestions",
  "Historique, synchronisation GitHub et API",
  "Bibliothèque TikZ, modèles et références",
  "Import PDF et reconnaissance de notes",
  "Assistant IA lorsque son fournisseur est configuré",
];

export function ComparisonSection() {
  return (
    <section className="py-24 @min-[40rem]:py-32">
      <div className="container">
        <Reveal>
          <SectionHeading title="Tous les outils, ouverts à tous." lede="Eneles ne réserve aucune fonction à une formule payante. Les protections techniques préservent simplement la stabilité du service." />
        </Reveal>
        <Reveal delay={0.08}>
          <ul className="mx-auto mt-12 grid max-w-4xl gap-3 @3xl:grid-cols-2">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-3 rounded-xl border border-line bg-card px-4 py-4 text-sm">
                <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-foreground/70" />
                <span className="text-muted-foreground">{feature}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
