import { API_URL, apiFetch } from "@/lib/api";
import type { BuildKey, PdfSource } from "@/hooks/useCompile";

function save(href: string, fileName: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** "My thesis: draft 2" as a file name the operating system accepts. */
export function pdfFileName(title: string | undefined): string {
  const name = (title ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${name || "document"}.pdf`;
}

/**
 * Saves the last compiled PDF to the person's computer. The archived build is fetched through the API when there is one (the copy in memory is handed to pdf.js, which can detach it); otherwise the copy in memory is used. Throws when neither works, so each caller can say so in its own place.
 */
export async function downloadCompiledPdf({ pdfUrl, buildKey, projectId, isAuthenticated, fileName }: { pdfUrl: PdfSource; buildKey: BuildKey; projectId?: string; isAuthenticated: boolean; fileName: string }): Promise<void> {
  if (buildKey && projectId && isAuthenticated) {
    const res = await apiFetch(`${API_URL}/projects/${projectId}/pdf?key=${encodeURIComponent(buildKey)}`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const href = URL.createObjectURL(await res.blob());
    save(href, fileName);
    setTimeout(() => URL.revokeObjectURL(href), 30_000);
    return;
  }
  if (typeof pdfUrl === "string") {
    save(pdfUrl, fileName);
    return;
  }
  const copy = new Uint8Array(pdfUrl.data.byteLength);
  copy.set(pdfUrl.data);
  const href = URL.createObjectURL(new Blob([copy], { type: "application/pdf" }));
  save(href, fileName);
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}
