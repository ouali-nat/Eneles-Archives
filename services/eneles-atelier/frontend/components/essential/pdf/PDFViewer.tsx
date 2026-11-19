"use client"

import dynamic from "next/dynamic"
import { PdfPagePlaceholder } from "./PdfPagePlaceholder";

export const PDFViewer = dynamic(
  () => import("./PDFViewerClient").then((mod) => mod.PDFViewerClient),
  {
    ssr: false,
    // A page-shaped placeholder that fits whatever box the viewer is in, from a list's thumbnail to the editor's preview pane.
    loading: () => <PdfPagePlaceholder />,
  }
)
