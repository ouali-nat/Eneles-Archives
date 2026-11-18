import type { Metadata } from "next";
import { Check } from "@/components/icons";
import { PageHeader } from "@/components/essential/layout/PageHeader";

export const metadata: Metadata = { title: "Accès Eneles" };

const INCLUDED = [
  "Projets et collaborateurs illimités",
  "Éditeur LaTeX, prévisualisation et compilation PDF",
  "Édition visuelle, collaboration, commentaires et historique",
  "Conversions PDF et images sans quota d’abonnement",
  "Bibliothèque TikZ, références et synchronisation GitHub",
  "Assistant IA lorsque les fournisseurs nécessaires sont opérationnels",
  "Stockage sans quota de formule, dans les limites techniques du service",
];

export default function AccessPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8">
      <PageHeader title="Accès Eneles" description="Toutes les fonctionnalités sont ouvertes à chaque membre, sans abonnement ni paiement." />
      <section className="mt-8 rounded-2xl border border-line bg-card p-6">
        <p className="text-sm font-semibold">Un seul accès : tout est inclus</p>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {INCLUDED.map((item) => <li key={item} className="flex gap-2.5 text-sm"><Check className="mt-0.5 size-4 shrink-0" aria-hidden /><span className="text-muted-foreground">{item}</span></li>)}
        </ul>
        <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-muted-foreground">Les limites de sécurité, de taille de fichier et de capacité du serveur restent appliquées pour maintenir le service disponible à tous. L’activation de fournisseurs externes, notamment pour l’IA, dépend de leur configuration technique.</p>
      </section>
    </div>
  );
}
