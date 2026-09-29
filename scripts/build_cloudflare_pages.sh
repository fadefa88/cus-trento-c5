#!/usr/bin/env bash
set -euo pipefail

# Cloudflare Pages build for this static site.
# It regenerates SEO pages (clean paths + sitemap) from the JSON content and
# copies only public website files into _site.

python3 scripts/generate_static_pages.py

OUT_DIR="_site"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Static site files and assets. Prerendered route directories are not listed
# here: the generator owns them and reports them with --list-output-dirs.
STATIC_PATHS="index.html robots.txt sitemap.xml _headers _redirects css js img assets content admin"
ROUTE_DIRS="$(python3 scripts/generate_static_pages.py --list-output-dirs | tr -d '\r')"

for path in $STATIC_PATHS $ROUTE_DIRS; do
  if [ -e "$path" ]; then
    cp -R "$path" "$OUT_DIR/"
  fi
done

# The frontend loads content/data.json at runtime. The source content/data.json
# is only a base dataset, while current editorial data lives in
# content/cms/*.json. Publish the same merged dataset the generator used so CMS
# edits reach the frontend with every deployment.
python3 scripts/site_data.py merge --root "$OUT_DIR"

# Every URL in the sitemap must be served by a prerendered page, otherwise the
# SPA fallback would silently answer with the home page.
python3 - <<'PY'
import re
import sys
from pathlib import Path

site = Path("_site")
sitemap = (site / "sitemap.xml").read_text(encoding="utf-8")
missing = []
for loc in re.findall(r"<loc>https?://[^/]+(/[^<]*)</loc>", sitemap):
    page = site / loc.strip("/") / "index.html" if loc != "/" else site / "index.html"
    if not page.is_file():
        missing.append(loc)
if missing:
    print(f"ERROR: {len(missing)} sitemap URLs have no prerendered page in _site, e.g. {missing[:5]}", file=sys.stderr)
    sys.exit(1)
print("Sitemap URLs all published.")
PY

# Add Cloudflare Pages response headers in the build output. Keeping this here
# avoids relying on manual dashboard settings and keeps the deployed site safer.
cat >> "$OUT_DIR/_headers" <<'EOF'

/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), document-domain=()
  Content-Security-Policy: base-uri 'self'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests

https://:project.pages.dev/*
  X-Robots-Tag: noindex, nofollow
https://:version.:project.pages.dev/*
  X-Robots-Tag: noindex, nofollow
/admin/*
  X-Robots-Tag: noindex, nofollow
EOF

# Safety: never publish CI/tooling folders if they are accidentally copied later.
rm -rf "$OUT_DIR/.git" "$OUT_DIR/.github" "$OUT_DIR/scripts"

find "$OUT_DIR" -type f | wc -l | awk '{print "Cloudflare Pages public files: " $1}'
du -sh "$OUT_DIR" 2>/dev/null | awk '{print "Cloudflare Pages public size: " $1}' || true
