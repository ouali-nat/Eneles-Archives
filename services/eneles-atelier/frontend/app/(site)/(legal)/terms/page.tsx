import Link from "next/link";
import type { Metadata } from "next";
import {
  LegalPage,
  LegalSection,
  LegalList,
} from "@/components/essential/legal/LegalPage";

export const metadata: Metadata = {
  title: "Terms of service",
  description:
    "Conditions d’utilisation d’Eneles Atelier, de son compte, des projets et des outils scientifiques.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Conditions d’utilisation"
      updated="2 April 2026"
      intro="Ces conditions décrivent l’utilisation d’Eneles Atelier depuis l’espace Eneles. Le code repris conserve ses avis de licence MIT ; cette licence du logiciel est distincte des conditions d’utilisation du service hébergé."
    >
      <LegalSection n={1} title="Who these terms are between">
        <p>
          &ldquo;Eneles&rdquo;, &ldquo;we&rdquo; and &ldquo;us&rdquo; refer to
          l’équipe qui exploite Eneles Atelier.
          &ldquo;You&rdquo; refers to the individual or organisation using it.
          By creating an account you agree to these terms. If you are agreeing
          on behalf of an employer or institution, you confirm you are
          authorised to do so.
        </p>
        <p>
          If you do not agree, you can still use the software: clone the
          repository and self-host it. Nothing in this agreement restricts your
          rights under the MIT licence.
        </p>
      </LegalSection>

      <LegalSection n={2} title="Accounts and sign-in">
        <p>
          L’accès à l’atelier réutilise la session Google déjà ouverte dans Eneles. Le service vérifie cette session auprès de Supabase Auth, puis crée une session propre à l’atelier. Aucune deuxième connexion ni mot de passe supplémentaire n’est demandé. Protégez votre compte Google et déconnectez-vous de l’espace Eneles lorsque vous quittez un appareil partagé.
        </p>
        <p>
          You are responsible for activity carried out under your account. Tell
          us at{" "}
          <a
            className="underline underline-offset-4"
            href="/contact"
          >
            le formulaire de contact Eneles
          </a>{" "}
          if you believe it has been accessed without your permission. You can
          revoke every active session at any time from your settings.
        </p>
        <p>
          L’utilisation du service doit respecter les règles d’âge et de consentement applicables dans votre pays. Lorsqu’un accord parental ou d’un responsable légal est requis, il doit être obtenu avant l’utilisation.
        </p>
      </LegalSection>

      <LegalSection n={3} title="Your content stays yours">
        <p>
          You keep all rights to the documents, images, PDFs, and LaTeX source
          you put into Eneles. We claim no ownership of it.
        </p>
        <p>
          To operate the service we need a narrow, practical licence: permission
          to store your content, transmit it, compile it, render previews of it,
          create the automatic version history described in these terms, and
          pass it to the sub-processors listed in the{" "}
          <Link className="underline underline-offset-4" href="/privacy">
            Privacy Policy
          </Link>{" "}
          where a feature requires it. That licence exists only to run the
          service for you, lasts only as long as you keep the content on the
          platform, and ends when you delete it.
        </p>
        <p className="font-medium text-foreground">
          We do not use your content to train machine-learning models, and we do
          not sell it or share it for advertising.
        </p>
        <p>
          If you share a project or make it publicly accessible, you are
          granting access to whoever you share it with. Consider what a link
          exposes before you create one.
        </p>
      </LegalSection>

      <LegalSection n={4} title="Acceptable use">
        <p>You agree not to use the hosted service to:</p>
        <LegalList
          items={[
            "Upload content you do not have the right to upload, or that infringes someone else's copyright.",
            "Break the law, or help someone else break it.",
            "Probe, scan, or attack the infrastructure, or try to reach accounts and data that are not yours.",
            "Contourner les protections de sécurité, les limites techniques de débit ou les mesures destinées à préserver la disponibilité du service.",
            "Revendre l’hébergement ou se présenter comme l’opérateur du service sans autorisation. Le code source conserve ses droits d’utilisation selon la licence MIT.",
            "Automate the interface in a way that degrades it for other users. Use the API instead; it exists for this.",
          ]}
        />
        <p>
          Nous pouvons suspendre un compte qui met en danger les systèmes ou perturbe fortement le service. Lorsque les circonstances le permettent, nous expliquons d’abord ce qui doit être corrigé.
        </p>
      </LegalSection>

      <LegalSection n={5} title="Accès gratuit" >
        <p>
          Toutes les fonctionnalités d’Eneles Atelier sont accessibles gratuitement. Aucune formule payante, carte bancaire ou souscription n’est nécessaire. Les éventuels fournisseurs externes, notamment les services d’IA, restent soumis à leurs propres conditions et peuvent nécessiter une configuration distincte.
        </p>
      </LegalSection>

      <LegalSection n={6} title="Usage limits and fair use">
        <p>
          Il n’existe aucun quota mensuel lié à une formule d’abonnement. Des limites techniques peuvent toutefois s’appliquer à la taille des fichiers, à la durée et au nombre de compilations simultanées, ainsi qu’au débit des requêtes. Elles protègent la stabilité du service pour tous les membres.
        </p>
        <p>
          En cas de trafic automatisé ou d’utilisation susceptible de dégrader le service pour les autres membres, nous pouvons temporairement ralentir ou suspendre les requêtes concernées.
        </p>
      </LegalSection>

      <LegalSection n={7} title="Availability, and what we do not promise">
        <p>
          We work to keep the service running, but it is provided on an
          &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. We do not
          offer a contractual uptime guarantee, and we may take the service down
          for maintenance, ideally with notice.
        </p>
        <p>
          Two limitations are worth stating plainly, because they are the ones
          that actually affect people:
        </p>
        <LegalList
          items={[
            "Automatic conversion is not perfect. Recognition of handwriting and PDFs is a best effort, and the output needs checking before you rely on it. Do not submit generated LaTeX to a journal or an examiner without reading it.",
            "Version history is a convenience, not a backup. Snapshots are retained for 30 days and then deleted automatically. Keep your own copies of anything you cannot afford to lose. The ZIP export exists for exactly this.",
          ]}
        />
      </LegalSection>

      <LegalSection n={8} title="Limitation of liability">
        <p>
          To the fullest extent the law allows, we are not liable for indirect,
          incidental, special, or consequential losses, or for lost profits,
          revenue, data, or goodwill, arising from your use of the service.
        </p>
        <p>
          Where liability cannot be excluded, our total liability for any claim
          is limited to the extent permitted by the mandatory law that applies to your situation. As the product is offered without a subscription fee, this clause does not remove any non-waivable consumer rights.
        </p>
        <p>
          Nothing here excludes liability that cannot lawfully be excluded,
          including for fraud, or for death or personal injury caused by
          negligence. If you are a consumer, your statutory rights are
          unaffected by anything in this agreement.
        </p>
      </LegalSection>

      <LegalSection n={9} title="Ending the agreement">
        <p>
          You can delete your account from settings at any time. Deletion
          closes the account at once and erases your projects, documents,
          uploads, and profile from the live service 30 days later; see the{" "}
          <Link className="underline underline-offset-4" href="/privacy">
            Privacy Policy
          </Link>{" "}
          for how long copies persist in backups and security logs. Export your
          work first, because deletion cannot be undone.
        </p>
        <p>
          Nous pouvons suspendre ou fermer un compte en cas de violation grave ou répétée de ces conditions. Les données et possibilités d’export sont traitées conformément à la politique de confidentialité.
        </p>
      </LegalSection>

      <LegalSection n={10} title="Changes to these terms">
        <p>
          We may update these terms. For material changes we will email
          registered users at least 30 days before they take effect, and update
          the date at the top of this page. Continuing to use the service after
          that means you accept the revised terms; if you do not, cancel and, if
          a paid period remains, contact us for a pro-rata refund.
        </p>
      </LegalSection>

      <LegalSection n={11} title="Governing law and contact">
        <p>
          Les règles applicables dépendent de la situation du membre et du pays où le service est exploité. Rien dans ces conditions ne retire les droits impératifs dont bénéficie un consommateur dans son pays de résidence.
        </p>
        <p>
          Questions about this agreement:{" "}
          <a
            className="underline underline-offset-4"
            href="/contact"
          >
            le formulaire de contact Eneles
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
