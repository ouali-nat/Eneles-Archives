import { getExampleById } from "./libraries"

/**
 * Prebuilt previews of the library's examples, shipped with the site as static images.
 *
 * The library repository renders each example (`node scripts/check.mjs --previews` there) and records which version of the example each image was made from; scripts/sync-content.mjs copies the images that are current into public/tikz-previews/ and gives those examples a `preview` address. An example without one is compiled on demand instead.
 */
export function prebuiltPreviewUrl(libraryId: string, exampleId: string, _source?: string): string | null {
  return getExampleById(libraryId, exampleId)?.preview ?? null
}

/** The dark theme's version of the prebuilt preview, when there is one: the same figure on a transparent ground, its colors kept. */
export function prebuiltPreviewDarkUrl(libraryId: string, exampleId: string): string | null {
  return getExampleById(libraryId, exampleId)?.previewDark ?? null
}
