#!/usr/bin/env bash
# Compiles the home page's example document and writes its first page, as it stands at three moments of the hero's scene, to public/hero/page-{1,2,3}.<hash>.svg, named by their content so a browser never shows an old page under a new name, and lists those names in components/essential/home/hero-pages.ts for the site to read. The pictures on the home page are these real pages, not drawings of one, so run this again after changing main.tex or references.bib (and keep the source shown in components/essential/home/HeroPreview.tsx the same as main.tex). Needs TeX Live (latexmk, pdflatex, bibtex) and pdftocairo (poppler).
#   1: before the sentence is written   2: with the sentence   3: with its citation
set -euo pipefail
declare -a names
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../../public/hero"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
sentence='Their braiding alone is dense in $SU(2)$'
for state in 1 2 3; do
  mkdir -p "$work/$state"
  cp "$here/references.bib" "$work/$state/"
  case $state in
    1) sed '/^%TYPED%$/d' "$here/main.tex" > "$work/$state/main.tex" ;;
    2) sed "s/^%TYPED%\$/$sentence./" "$here/main.tex" > "$work/$state/main.tex" ;;
    3) sed "s/^%TYPED%\$/$sentence~\\\\cite{freedman02}./" "$here/main.tex" > "$work/$state/main.tex" ;;
  esac
  (cd "$work/$state" && latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex > /dev/null)
  pages=$(pdfinfo "$work/$state/main.pdf" | awk '/^Pages:/ {print $2}')
  if [ "$pages" != "1" ]; then echo "main.tex runs to $pages pages in state $state; the hero shows one: shorten it." >&2; exit 1; fi
  pdftocairo -svg -f 1 -l 1 "$work/$state/main.pdf" "$work/page-$state.svg"
  hash=$(sha256sum "$work/page-$state.svg" | cut -c1-10)
  names[$state]="page-$state.$hash.svg"
done
rm -f "$out"/page-*.svg
for state in 1 2 3; do
  cp "$work/page-$state.svg" "$out/${names[$state]}"
  echo "${names[$state]} $(wc -c < "$out/${names[$state]}") bytes"
done
cat > "$here/../../components/essential/home/hero-pages.ts" <<TS
// Written by scripts/hero-document/build.sh: the hero document's first page at three moments of the scene (before the sentence, with it, and with its citation), each named by its content. Do not edit by hand; run the script.
export const HERO_PAGES = ["/hero/${names[1]}", "/hero/${names[2]}", "/hero/${names[3]}"] as const;
TS
