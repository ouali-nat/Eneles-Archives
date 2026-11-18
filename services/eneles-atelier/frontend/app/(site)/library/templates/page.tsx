import { permanentRedirect } from "next/navigation";

/** Templates are a section of the library page; this keeps the obvious URL working. */
export default function LibraryTemplatesPage() {
  permanentRedirect("/library#templates");
}
