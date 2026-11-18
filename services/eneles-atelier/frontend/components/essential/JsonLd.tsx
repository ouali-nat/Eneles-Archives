/**
 * Structured data for search engines and AI assistants (lib/seo/jsonld.ts), as a JSON-LD script tag.
 *
 * Every `<` is written as its Unicode escape, so a page title or an example's source that contains a closing script tag cannot end the tag early and run as markup. JSON parsers read the escape back as the same character.
 */
export function JsonLd({ data }: { data: object | null }) {
  if (!data) return null;
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
