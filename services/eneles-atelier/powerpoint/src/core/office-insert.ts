export interface InsertImageOptions {
  widthPt: number;
  heightPt: number;
}

function setSelectedDataAsync(
  data: string,
  options: Office.SetSelectedDataOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    Office.context.document.setSelectedDataAsync(data, options, (result) => {
      if (result.status === Office.AsyncResultStatus.Failed) {
        reject(new Error(result.error?.message || "Office.js insert failed"));
      } else {
        resolve();
      }
    });
  });
}

/** The reliable path: insert a rasterized PNG as a picture. Works on every PowerPoint build. */
export async function insertPngIntoSlide(base64Png: string, opts: InsertImageOptions): Promise<void> {
  await setSelectedDataAsync(base64Png, {
    coercionType: Office.CoercionType.Image,
    imageWidth: opts.widthPt,
    imageHeight: opts.heightPt,
  });
}

/**
 * Insert the SVG as a vector picture. The string must already be flattened
 * (pixel width/height, no currentColor, no <use>) or PowerPoint shows
 * "The picture can't be displayed".
 */
export async function insertSvgIntoSlideExperimental(svgString: string, opts: InsertImageOptions): Promise<void> {
  const xmlSvg = (Office.CoercionType as { XmlSvg?: Office.CoercionType }).XmlSvg;
  if (!xmlSvg) {
    throw new Error("This PowerPoint build cannot insert SVG. Use Insert picture instead.");
  }
  // Office.js wants the SVG XML string, not base64. Base64 produces a
  // picture object that PowerPoint cannot paint.
  await setSelectedDataAsync(svgString, {
    coercionType: xmlSvg,
    imageWidth: opts.widthPt,
    imageHeight: opts.heightPt,
  });
}

export function isInsideOffice(): boolean {
  return typeof Office !== "undefined" && !!Office.context && !!Office.context.document;
}
