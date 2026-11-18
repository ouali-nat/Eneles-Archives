import Link from "next/link";
import { Accordion } from "@/components/ui/accordion";
import { Reveal } from "./_shared";

const FAQS = [
  {
    q: "Is it really free with unlimited collaborators?",
    a: "Yes. All Eneles features are available without a subscription. Fair-use and infrastructure safeguards still apply to protect the shared service.",
  },
  {
    q: "Can it read my handwritten notes?",
    a: "Yes. Upload a photo, a screenshot, or a PDF, and Eneles returns LaTeX source that opens in the editor. Recognition is a best effort, so check the result before you rely on it. There is no monthly subscription quota for conversions. File-size and service-capacity safeguards still apply.",
  },
  {
    q: "Can I bring an existing project?",
    a: "Upload a ZIP, import a paper from arXiv by its ID, or pull from a GitHub repository. Folders, images, and bibliographies come with it, and you can download everything as a ZIP at any time.",
  },
  {
    q: "Which TeX distribution does it compile with?",
    a: "Full TeX Live, with pdfLaTeX, XeLaTeX, LuaLaTeX, and LaTeX. BibTeX or Biber, makeindex, and glossaries run when the document needs them, and each compile is subject to the same technical runtime limit for everyone.",
  },
  {
    q: "How do track changes work?",
    a: "Select a passage and press Suggest, and your rewrite is recorded as a suggestion instead of applied: the old words struck out, the new ones highlighted. Anyone with edit access accepts or rejects them, one at a time or all at once. Comments stay attached to their text as the document changes.",
  },
  {
    q: "What happens when GitHub and Eneles both changed a file?",
    a: "Push is refused until you pull. On a pull, Eneles keeps its own version and saves GitHub's beside it, so nothing is overwritten and you choose what to keep.",
  },
  {
    q: "Do I need to already know LaTeX?",
    a: "It helps, but the visual mode shows headings, lists, and equations as they will look, autocomplete suggests commands, citations, and labels, and the TikZ library and templates give you working starting points.",
  },
  {
    q: "What happens to my documents?",
    a: "They are encrypted in transit and never used to train machine-learning models, ours or anyone else's. The privacy policy has the details, and you can self-host if your institution needs the data on its own servers.",
  },
  {
    q: "Do I have to pay for an account?",
    a: "No. All product features are free to use. Some external providers, such as AI model APIs, can still require their own configuration or charge their provider directly.",
  },
];

export function FAQSection() {
  return (
    <section aria-labelledby="faq-title" className="py-24 @min-[40rem]:py-32">
      <div className="container">
        <Reveal>
          <div className="mx-auto max-w-3xl text-center">
            <h2 id="faq-title" className="text-3xl font-semibold tracking-[-0.02em] text-pretty @min-[40rem]:text-4xl">
              Answers, before you sign up
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground text-pretty">
              Still stuck on something?{" "}
              <Link href="/docs" className="font-medium text-foreground underline underline-offset-4">
                Read the docs
              </Link>{" "}
              or{" "}
              <Link href="/contact" className="font-medium text-foreground underline underline-offset-4">
                contact us
              </Link>
              .
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.08} className="mx-auto mt-12 max-w-3xl">
          {/* The kit's accordion, each question a card of its own, one open at a time. */}
          <Accordion variant="cards" items={FAQS.map((f, i) => ({ id: `faq-${i}`, title: f.q, content: f.a }))} />
        </Reveal>
      </div>
    </section>
  );
}
