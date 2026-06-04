#!/usr/bin/env bash
set -euo pipefail

# Cloudflare Pages build for this static site.
# It copies only public website assets into _site, excluding GitHub Actions,
# Python scripts, local tooling and documentation.

OUT_DIR="_site"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

for path in index.html css js img content admin _headers _redirects; do
  if [ -e "$path" ]; then
    cp -R "$path" "$OUT_DIR/"
  fi
done

# Safety: never publish CI/tooling folders if they are accidentally copied later.
rm -rf "$OUT_DIR/.git" "$OUT_DIR/.github" "$OUT_DIR/scripts"

find "$OUT_DIR" -type f | wc -l | awk '{print "Cloudflare Pages public files: " $1}'
du -sh "$OUT_DIR" | awk '{print "Cloudflare Pages public size: " $1}'
