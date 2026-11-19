# LaTeX Templates Prebuild

Pre-renders all LaTeX templates to PDF and first-page thumbnails, then uploads them to the **builds bucket** under:
- `latex-templates/{templateId}.pdf`
- `latex-templates/{templateId}-thumb.png`

These files are served by `GET /templates/:id/pdf` and `GET /templates/:id/thumb` (signed URLs, 1h expiry).

## When to Run

Run after **new build/deploy** of the compiler or api, or when you add/change templates in `web/lib/latex-templates.ts`.

## Run Locally

```bash
cd api
# 1. Sync templates from web (updates latex-templates.json)
node ../web/scripts/sync-latex-templates.mjs

# 2. Ensure compiler is running (e.g. docker run -p 3500:3500 texer-compiler)
# Load .env or set: COMPILER_URL, BUILDS_BUCKET_NAME, BUILDS_BUCKET_ACCESS_KEY_ID, BUILDS_BUCKET_SECRET_ACCESS_KEY

node scripts/prebuild-latex-templates.mjs
```

## Bucket Lifecycle (CRITICAL)

**Ensure `latex-templates/*` is excluded from any expiration or deletion rules**: same as `tikz-components/`.

If your builds bucket has a lifecycle rule that deletes objects after 24 hours (or similar), add a **prefix exception** so `latex-templates/` is kept permanently:

- **Supabase Storage**: Exclude prefix `latex-templates/`.
- **AWS S3**: Apply expiration only to project build paths, not `latex-templates/*` or `tikz-components/*`.
- **MinIO**: Same concept, exclude the `latex-templates/` prefix from expiration.

Template PDFs and thumbnails must not be deleted, just like TikZ component images.

## API

- `GET /templates/:id/pdf`: returns `{ url: "signed-url" }` for the PDF
- `GET /templates/:id/thumb`: returns `{ url: "signed-url" }` for the first-page PNG
