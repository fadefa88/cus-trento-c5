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

# Safety cleanup: keep the header title only as "CUS Trento C5" across every
# prerendered HTML page, even if a legacy generated file is still present.
python3 - <<'PY'
from pathlib import Path
TAG = '<small>Uni.Team Futsal</small>'
for path in Path('_site').rglob('*.html'):
    text = path.read_text(encoding='utf-8')
    if TAG in text:
        path.write_text(text.replace(TAG, ''), encoding='utf-8')
PY

# The legacy app.js still contains the former direct Web3Forms fallback.
# In the deployed output, the protected Cloudflare Pages Function is authoritative.
if [ -f "$OUT_DIR/js/app.js" ]; then
  python3 - <<'PY'
from pathlib import Path
path = Path("_site/js/app.js")
text = path.read_text(encoding="utf-8")
text = text.replace('const CONTACT_FORM_ENDPOINT="https://api.web3forms.com/submit";', 'const CONTACT_FORM_ENDPOINT="/api/contact";')
text = text.replace('const CONTACT_FORM_ACCESS_KEY="75c56aa3-61e6-4377-bee3-b341ec8da5f7";', 'const CONTACT_FORM_ACCESS_KEY="";')
path.write_text(text, encoding="utf-8")
PY
fi

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
du -sh "$OUT_DIR" | awk '{print "Cloudflare Pages public size: " $1}'
