import { permanentRedirect } from "next/navigation";

/** The TikZ browser moved under /library. Kept so old links keep resolving. */
export default async function LegacyTikzExamplePage({
  params,
}: {
  params: Promise<{ library: string; example: string }>;
}) {
  const { library, example } = await params;
  permanentRedirect(`/library/${library}/${example}`);
}
