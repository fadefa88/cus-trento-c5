#!/usr/bin/env bash
set -euo pipefail

# Cloudflare Pages build for this static site.
# It regenerates SEO pages (clean paths + sitemap) from the JSON content and
# copies only public website assets into _site.

python3 scripts/generate_static_pages.py

OUT_DIR="_site"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

for path in \
  index.html robots.txt sitemap.xml _headers _redirects \
  css js img assets content admin \
  news squadra staff calendario classifica statistiche coppa matchday gallery video social club sponsor hall-of-fame contatti privacy cookies under-21; do
  if [ -e "$path" ]; then
    cp -R "$path" "$OUT_DIR/"
  fi
done

# Safety: never publish CI/tooling folders if they are accidentally copied later.
rm -rf "$OUT_DIR/.git" "$OUT_DIR/.github" "$OUT_DIR/scripts"

find "$OUT_DIR" -type f | wc -l | awk '{print "Cloudflare Pages public files: " $1}'
du -sh "$OUT_DIR" | awk '{print "Cloudflare Pages public size: " $1}'
