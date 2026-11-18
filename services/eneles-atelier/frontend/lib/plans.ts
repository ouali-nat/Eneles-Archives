/** Eneles has one public plan: every product feature is available to every member.
 * Infrastructure-level protection (request size, concurrency and abuse throttles)
 * remains in place so one account cannot exhaust the shared service.
 */
export type PlanId = "free" | "pro" | "team";
export interface Plan {
  id: PlanId; name: string; tagline: string; monthly: number; yearly: number;
  featured?: boolean; highlights: string[];
}
export const PLANS: Plan[] = [{
  id: "free", name: "Eneles", tagline: "Toutes les fonctionnalités, sans abonnement", monthly: 0, yearly: 0,
  highlights: [
    "Projets et collaborateurs illimités",
    "Édition LaTeX visuelle et textuelle",
    "Compilation PDF et prévisualisation",
    "Collaboration en temps réel, commentaires et historique",
    "Import PDF, ZIP, DOI et arXiv",
    "Conversions d’images et de PDF sans quota d’abonnement",
    "Bibliothèque TikZ et outils scientifiques",
    "Assistant IA lorsque le fournisseur de modèles est configuré",
    "Synchronisation GitHub et API",
    "Stockage sans quota de formule, dans les limites techniques du service",
  ],
}];
export type ComparisonValue = boolean | string;
export const COMPARISON: { feature: string; free: ComparisonValue }[] = [
  { feature: "Projets et collaborateurs", free: "Illimités" },
  { feature: "Éditeur LaTeX et prévisualisation PDF", free: true },
  { feature: "Édition visuelle et correction", free: true },
  { feature: "Commentaires, historique et édition collaborative", free: true },
  { feature: "BibTeX, Biber et index", free: true },
  { feature: "Synchronisation GitHub et références DOI/arXiv", free: true },
  { feature: "Import ZIP et PDF", free: true },
  { feature: "Bibliothèque TikZ et studio visuel", free: true },
  { feature: "Conversions d’images et de PDF", free: "Sans quota d’abonnement" },
  { feature: "Assistant IA", free: "Disponible lorsque le service IA est configuré" },
  { feature: "API", free: true },
  { feature: "Stockage", free: "Sans quota de formule" },
];
export function yearlySaving(_plan: Plan): number { return 0; }
export const YEARLY_SAVING = 0;
export function formatPrice(amount: number): string { return amount === 0 ? "Gratuit" : `${amount.toFixed(2)}`; }
