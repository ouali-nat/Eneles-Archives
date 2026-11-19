import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/essential/legal/LegalPage";

export const metadata: Metadata = {
  title: "Paiements et remboursements",
  description: "Eneles Atelier est accessible gratuitement, sans abonnement ni paiement de formule.",
};

export default function RefundsPage() {
  return (
    <LegalPage title="Paiements et remboursements" updated="18 novembre 2026" intro="Eneles Atelier ne propose pas de formules payantes et ne demande aucun paiement pour accéder à ses fonctionnalités." >
      <LegalSection n={1} title="Aucun abonnement Eneles" >
        <p>Toutes les fonctionnalités d’Eneles Atelier sont proposées sans abonnement. Il n’y a donc ni renouvellement, ni annulation d’abonnement, ni remboursement de formule à effectuer.</p>
      </LegalSection>
      <LegalSection n={2} title="Fournisseurs externes" >
        <p>Certains services externes éventuellement connectés (par exemple un fournisseur de modèles d’intelligence artificielle ou un fournisseur de stockage tiers) peuvent avoir leurs propres conditions et tarifs. Ces éventuels paiements sont distincts d’un abonnement Eneles et doivent être vérifiés directement auprès du fournisseur avant activation.</p>
      </LegalSection>
      <LegalSection n={3} title="Une question ?" >
        <p>Pour toute question relative à l’accès ou aux services Eneles, utilisez le <a className="underline underline-offset-4" href="/contact">formulaire de contact</a>.</p>
      </LegalSection>
    </LegalPage>
  );
}
