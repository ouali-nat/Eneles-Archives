# TikZ previews

Every example in the TikZ library (the `library` repository, beside `frontend`) has a rendered preview on the Library pages and in the editor's TikZ template picker. Previews come from the first of these that has one:

1. **A static image shipped with the frontend.** The library repository keeps an image of each example in `previews/<package>/<example>.png`, with `previews/keys.json` saying which version of each example it was made from. `frontend/scripts/sync-content.mjs` (run before `next dev` and `next build`) copies the images that are current into `frontend/public/tikz-previews/` and gives those examples a `preview` address in `frontend/content/library.json`. This is the normal path, in development and in production, and it needs no request to the API.
2. **An image in the builds bucket** at `tikz-components/<package>/<example>.png`, served by `GET /tikz-components/:package/:example`. This answers 404 whenever the bucket has no such object, which is the case in development: nothing has been uploaded to the development bucket. The frontend asks for it only when an example has no static image.
3. **A live compile** through `POST /tikz-compile`, cached by the API (Redis, or memory) and rate limited per visitor.

## Making the images (the usual step)

After adding or changing examples, in the library repository:

```bash
node scripts/check.mjs --previews
```

This checks the metadata, compiles every example with pdfLaTeX the way the site wraps it, also compiles it the way the editor's picker inserts it into an empty article, and renders each first page to PNG with `pdftocairo`. Commit the images with the change. Production gets them through the normal content deploy: a push to the library's `main` triggers the frontend's `deploy-content.yml`, and the build's `sync-content.mjs` copies them into `public/`. TeX Live is needed only where the images are made, not on the build server.

## The bucket (optional)

`prebuild-tikz-components.mjs` uploads PNGs to the builds bucket instead. With the static images in place it is not needed. If it is used, first refresh `tikz-examples.json` with `node scripts/sync-tikz-examples.mjs` from `frontend/`, and keep `tikz-components/*` out of any expiry rule on the bucket. It wraps examples in its own 20 cm page rather than the site's wrapper, so its images have wide margins.
