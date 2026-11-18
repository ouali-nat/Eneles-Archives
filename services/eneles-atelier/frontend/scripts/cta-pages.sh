#!/usr/bin/env bash
# Renders the pages the home page's closing section fans out beside its headline: two pages of the fusion package's manual (packages/fusion/fusion-doc.pdf, compiled by TeX), written to public/cta/. The hero document's page (public/hero/page-3.svg, scripts/hero-document/build.sh) is the third. Run this again after the manual changes. Needs pdftocairo (poppler).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
manual="$here/../../packages/fusion/fusion-doc.pdf"
out="$here/../public/cta"
mkdir -p "$out"
for page in 16 18; do
  pdftocairo -png -singlefile -f "$page" -l "$page" -scale-to-x 900 -scale-to-y -1 "$manual" "$out/fusion-manual-$page"
  echo "fusion-manual-$page.png $(wc -c < "$out/fusion-manual-$page.png") bytes"
done
