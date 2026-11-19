export interface ExtractedImage {
  src: string
  page: number
  width: number
  height: number
}

/**
 * Extract embedded images from a PDF using pdfjs operatorList.
 * Dynamically imports pdfjs-dist to avoid SSR issues (DOMMatrix, canvas, etc.).
 */
export async function extractImagesFromPdf(
  pdfUrl: string,
  maxImages = 50,
): Promise<ExtractedImage[]> {
  if (typeof window === "undefined") return []

  const { pdfjs } = await import("react-pdf")
  // Local copy, placed in public/ by the postinstall script. Loading this from
  // unpkg meant executing whatever that CDN served for the version string, and
  // it was blocked by our CSP in any case.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"

  const images: ExtractedImage[] = []

  try {
    // pdf.js 6 no longer compiles font programs with eval, so the old
    // `isEvalSupported: false` hardening flag is gone with it.
    const pdf = await pdfjs.getDocument({ url: pdfUrl }).promise
    const numPages = pdf.numPages

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      if (images.length >= maxImages) break

      const page = await pdf.getPage(pageNum)
      const ops = await page.getOperatorList()

      for (let i = 0; i < ops.fnArray.length; i++) {
        if (images.length >= maxImages) break

        if (
          ops.fnArray[i] === pdfjs.OPS.paintImageXObject ||
          ops.fnArray[i] === pdfjs.OPS.paintXObject
        ) {
          const imgName = ops.argsArray[i][0]
          try {
            const imgData = await page.objs.get(imgName) as any
            if (!imgData || !imgData.data) continue

            const w = imgData.width
            const h = imgData.height

            if (w < 50 || h < 50) continue

            const canvas = document.createElement("canvas")
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext("2d")
            if (!ctx) continue

            const imageData = ctx.createImageData(w, h)

            if (imgData.data.length === w * h * 4) {
              imageData.data.set(imgData.data)
            } else if (imgData.data.length === w * h * 3) {
              for (let j = 0; j < w * h; j++) {
                imageData.data[j * 4] = imgData.data[j * 3]
                imageData.data[j * 4 + 1] = imgData.data[j * 3 + 1]
                imageData.data[j * 4 + 2] = imgData.data[j * 3 + 2]
                imageData.data[j * 4 + 3] = 255
              }
            } else {
              for (let j = 0; j < w * h; j++) {
                const v = imgData.data[j] ?? 0
                imageData.data[j * 4] = v
                imageData.data[j * 4 + 1] = v
                imageData.data[j * 4 + 2] = v
                imageData.data[j * 4 + 3] = 255
              }
            }

            ctx.putImageData(imageData, 0, 0)
            const dataUrl = canvas.toDataURL("image/png")

            images.push({ src: dataUrl, page: pageNum, width: w, height: h })
          } catch {
            // Some image objects can't be decoded; skip them
          }
        }
      }

      page.cleanup()
    }
  } catch (err) {
    console.warn("[PdfImageExtractor] Failed to extract images:", err)
  }

  return images
}
