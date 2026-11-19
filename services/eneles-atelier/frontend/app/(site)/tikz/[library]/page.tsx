import { permanentRedirect } from "next/navigation";

/** The TikZ browser moved under /library. Kept so old links keep resolving. */
export default async function LegacyTikzLibraryPage({
  params,
}: {
  params: Promise<{ library: string }>;
}) {
  const { library } = await params;
  permanentRedirect(`/library/${library}`);
}
