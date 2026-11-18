import { permanentRedirect } from "next/navigation";

/** The TikZ browser moved under /library. Kept so old links keep resolving. */
export default function LegacyTikzPage() {
  permanentRedirect("/library");
}
