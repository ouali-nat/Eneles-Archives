/**
 * Get the number of pages in a PDF buffer.
 * Uses pdf-to-img which is already a dependency.
 */
export async function getPdfPageCount(buffer: Buffer): Promise<number> {
  const { pdf } = await import('pdf-to-img');
  const dataUrl = `data:application/pdf;base64,${buffer.toString('base64')}`;
  const doc = await pdf(dataUrl, { scale: 1 });
  return doc.length;
}
