import { cn } from "@/lib/utils";

/** A blank page in the shimmer of the Skeleton primitive, standing in for a PDF while its engine or document loads. It fills the box it is given at a page's proportions (A4), so the page that replaces it lands in the same place. */
export function PdfPagePlaceholder({ className }: { className?: string }) {
  return (
    <div role="status" aria-label="Loading the PDF" className={cn("flex size-full items-center justify-center", className)}>
      <div aria-hidden className="skeleton aspect-[1/1.414] max-h-full w-full rounded-[var(--radius-inset)]" />
    </div>
  );
}
