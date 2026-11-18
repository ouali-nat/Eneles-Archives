import { permanentRedirect } from "next/navigation";

/** Templates moved under the library browser. Kept so old links resolve. */
export default async function LegacyTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  permanentRedirect(`/library/templates/${id}`);
}
