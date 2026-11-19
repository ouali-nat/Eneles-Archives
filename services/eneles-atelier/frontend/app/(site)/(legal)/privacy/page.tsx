import Link from "next/link";
import type { Metadata } from "next";
import {
  LegalPage,
  LegalSection,
  LegalList,
} from "@/components/essential/legal/LegalPage";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What data Eneles collects, which sub-processors it uses, how long it is kept, and how to export or delete it.",
};

/** The real third parties data reaches. Keep in step with the backend. */
const SUBPROCESSORS = [
  {
    name: "Supabase Auth",
    purpose: "Vérification de la session Google déjà utilisée par Eneles",
    data: "Identifiant Supabase, adresse e-mail vérifiée et métadonnées minimales du profil",
  },
  {
    name: "Resend (si configuré)",
    purpose: "Courriels transactionnels de l’API, par exemple invitations",
    data: "Adresse e-mail et contenu du message concerné",
  },
  {
    name: "Stockage objet compatible S3/R2 (à configurer pour l’hébergement durable)",
    purpose: "Storing uploads, compiled PDFs, and generated thumbnails",
    data: "Files you upload and documents you compile",
  },
  {
    name: "Fournisseur IA de la plateforme (si configuré)",
    purpose: "Conversions ou assistance IA lancées explicitement par le membre",
    data: "Uniquement le contenu transmis pour le traitement demandé",
  },
  {
    name: "Fournisseurs de modèles IA choisis ou configurés",
    purpose: "Assistant IA, uniquement lorsque ce service est activé et utilisé",
    data: "Le message et les éléments du projet explicitement transmis",
  },
  {
    name: "doi.org and arXiv",
    purpose: "Turning a DOI or arXiv ID you enter into a bibliography entry",
    data: "The identifier you looked up, nothing about you",
  },
  {
    name: "GitHub",
    purpose: "Syncing a project with a repository, only if you link one",
    data: "The project's files, sent with the access token you provided",
  },
  {
    name: "Umami (si activé)",
    purpose: "Aggregate page analytics on the marketing site",
    data: "Page path, referrer, country, device type. No cookies, no cross-site identifier",
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="9 November 2026"
      intro="Cette politique décrit les catégories de données susceptibles d’être traitées par Eneles Atelier. Les prestataires d’hébergement, de base de données et de stockage durable devront être confirmés et ajoutés ici avant l’ouverture publique du service."
    >
      <LegalSection n={1} title="The short version">
        <LegalList
          items={[
            "We collect the minimum needed to run an account: your email address, whatever profile details you choose to add, and the content you upload.",
            "La connexion à l’atelier réutilise le compte Google déjà ouvert dans Eneles via Supabase Auth ; l’atelier ne demande pas de deuxième mot de passe.",
            "Your documents are never used to train machine-learning models, ours or anyone else's.",
            "We do not sell personal data, and we run no advertising or cross-site tracking.",
            "You can export everything as JSON, or delete the account outright, from your settings, without emailing anyone.",
          ]}
        />
      </LegalSection>

      <LegalSection n={2} title="What we collect">
        <p className="font-medium text-foreground">Account data</p>
        <p>
          L’adresse e-mail et l’identifiant fournis par le compte Eneles/Supabase vérifié, ainsi que le nom de profil et les informations que vous choisissez d’ajouter à votre compte Atelier.
        </p>

        <p className="font-medium text-foreground">Content</p>
        <p>
          Projects, LaTeX source, uploaded images and PDFs, compiled output, and
          the documents you create, along with the comments, suggested changes,
          and chat messages you and your collaborators write in a project. This
          is stored so we can give it back to you. Comments and chat are visible
          to everyone the project is shared with and are deleted with the
          project.
        </p>

        <p className="font-medium text-foreground">GitHub</p>
        <p>
          If you link a project to a GitHub repository, we store the repository
          name and the access token you give us, encrypted, and use the token
          only for that project&apos;s pushes and pulls. Pushing sends the
          project&apos;s files to GitHub, under GitHub&apos;s own terms.
          Unlinking deletes the token.
        </p>

        <p className="font-medium text-foreground">Technical and security data</p>
        <p>
          Pour sécuriser les sessions et enquêter sur les incidents, l’API peut conserver des informations techniques telles que l’adresse IP, le navigateur, le système d’exploitation et les événements de sécurité (connexion, changements du compte, suppression).
        </p>

        <p className="font-medium text-foreground">Usage counters</p>
        <p>
          Des compteurs techniques peuvent enregistrer le nombre de conversions et l’espace utilisé pour afficher les statistiques et protéger la capacité du service. Ils ne remplacent pas les documents eux-mêmes.
        </p>

        <p className="font-medium text-foreground">Données de paiement</p>
        <p>Eneles Atelier ne facture aucun abonnement et ne demande aucune carte bancaire pour accéder à ses fonctionnalités.</p>
      </LegalSection>

      <LegalSection n={3} title="Why we are allowed to process it">
        <p>
          La base juridique du traitement et les droits applicables dépendent du lieu où réside le membre et des règles en vigueur. Les données nécessaires à l’ouverture de la session, au fonctionnement des projets et à la sécurité sont traitées pour fournir le service ; les traitements facultatifs ne doivent être activés qu’avec les informations et consentements requis.
        </p>
      </LegalSection>

      <LegalSection n={4} title="Who else touches your data">
        <p>
          Les catégories ci-dessous décrivent les services prévus par le code. La liste définitive, les coordonnées de l’opérateur, les pays d’hébergement et les durées réelles de conservation doivent être vérifiés après le choix de l’hébergement permanent, avant l’ouverture publique.
        </p>

        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-surface/40 text-start">
                <th className="px-4 py-3 font-semibold text-foreground">
                  Provider
                </th>
                <th className="px-4 py-3 font-semibold text-foreground">
                  Purpose
                </th>
                <th className="px-4 py-3 font-semibold text-foreground">
                  Data involved
                </th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSORS.map((p) => (
                <tr key={p.name} className="border-b last:border-0 align-top">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {p.name}
                  </td>
                  <td className="px-4 py-3">{p.purpose}</td>
                  <td className="px-4 py-3">{p.data}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p>
          Two things worth being explicit about. First, Axya and the AI
          providers only ever receive what a request you started includes: the
          image, PDF, or audio clip you converted, or your message to the
          assistant and the project files sent with it. Opening the editor
          sends nothing. Second, we use these
          providers under terms that exclude your requests from model training,
          and we do not use your content for training either. Provider terms
          change; if that ever stops being true we will say so here and in the
          changelog before it takes effect.
        </p>
        <p>
          If none of that is acceptable for your data, self-host. The entire
          stack is MIT licensed, you can point it at your own AI keys or none at
          all, and no data leaves your infrastructure.
        </p>
      </LegalSection>

      <LegalSection n={5} title="How long it is kept">
        <LegalList
          items={[
            "Projects and uploads: until you delete them, or until 30 days after you delete your account.",
            "Comptes supprimés : désactivés immédiatement ; les données associées sont traitées selon les délais de suppression et de sauvegarde configurés par le service.",
            "Version history snapshots: 30 days, then deleted automatically. This is a convenience feature, not a backup, so keep your own copies.",
            "Sign-in codes: expire within minutes and are purged hourly.",
            "Sessions: until they expire or you revoke them; inactive sessions are cleared after 7 days.",
            "Security audit logs: retained beyond account deletion where needed to investigate abuse or meet a legal obligation.",
            "Encrypted backups: deleted content can persist in backups for up to 30 days before rotating out.",
          ]}
        />
      </LegalSection>

      <LegalSection n={6} title="Your rights">
        <p>
          Depending on where you live you may have the right to access, correct,
          delete, restrict, or object to processing of your personal data, and to
          receive it in a portable format. Two of these are built into the
          product rather than requiring a request:
        </p>
        <LegalList
          items={[
            "Export: Settings gives you a JSON file containing your account data, projects, and metadata.",
            "Deletion: Settings closes the account at once. You are signed out everywhere and its API keys stop working. Its content is erased 30 days later. It cannot be undone, so export first.",
          ]}
        />
        <p>
          For anything else, email{" "}
          <a
            className="underline underline-offset-4"
            href="/contact"
          >
            le formulaire de contact Eneles
          </a>
          . We aim to respond within 30 days. If you are in the UK or EU and are
          unhappy with our response, you may complain to your national data
          protection authority.
        </p>
      </LegalSection>

      <LegalSection n={7} title="Cookies and analytics">
        <p>
          We set two essential cookies to keep you signed in. One holds your
          sign-in; it is HttpOnly, so no script on a page can read it. The
          other only tells the site that you are signed in. There are no
          advertising cookies and no third-party trackers.
        </p>
        <p>
          The marketing site uses a self-hosted Umami instance for aggregate
          page statistics. It sets no cookies, collects no cross-site
          identifier, and produces counts rather than profiles, which is why
          there is no cookie banner asking for your consent to it.
        </p>
      </LegalSection>

      <LegalSection n={8} title="Security">
        <p>
          Data is encrypted in transit with TLS. At rest it is stored with
          providers that encrypt their storage and database volumes; we do not
          add a separate application-level encryption layer on top, and we say
          so because &ldquo;encrypted at rest&rdquo; on its own tends to imply
          more than it means. File access uses short-lived signed URLs rather
          than public links. There are no passwords to leak, and two-factor
          authentication is available in settings.
        </p>
        <p>
          What we do not have: a third-party certification such as SOC 2 or ISO
          27001. Those are audits of process documentation, and for a project of
          this size the cost is better spent on the controls themselves. The
          code is open, so the controls can be read rather than taken on trust.
        </p>
        <p>
          No system is perfectly secure. If we discover a breach affecting your
          personal data we will notify affected users and the relevant authority
          without undue delay, and within 72 hours where the GDPR requires it.
        </p>
        <p>
          Found a vulnerability? Please report it privately to{" "}
          <a
            className="underline underline-offset-4"
            href="/contact"
          >
            le formulaire de contact Eneles
          </a>{" "}
          rather than opening a public issue.
        </p>
      </LegalSection>

      <LegalSection n={9} title="International transfers and children">
        <p>
          Les prestataires techniques peuvent traiter des données dans plusieurs pays. Les pays d’hébergement, les garanties de transfert et les coordonnées du responsable du traitement doivent être confirmés et renseignés avant l’ouverture publique de l’atelier.
        </p>
        <p>
          L’utilisation du service doit respecter les règles d’âge et de consentement applicables dans le pays du membre. Lorsqu’un accord parental ou d’un responsable légal est requis, il doit être obtenu avant l’utilisation.
        </p>
      </LegalSection>

      <LegalSection n={10} title="Changes and contact">
        <p>
          Cette politique doit être mise à jour avant la mise en production avec le nom et les coordonnées de l’opérateur, les prestataires effectivement utilisés, les régions d’hébergement et les durées de conservation réelles.
        </p>
        <p>
          Privacy questions:{" "}
          <a
            className="underline underline-offset-4"
            href="/contact"
          >
            le formulaire de contact Eneles
          </a>
          . See also the{" "}
          <Link className="underline underline-offset-4" href="/terms">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link className="underline underline-offset-4" href="/refunds">
            Refund Policy
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
