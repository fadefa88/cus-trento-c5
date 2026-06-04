# Cloudflare Pages migration notes

Recommended Cloudflare Pages settings:

- Framework preset: None
- Build command: `bash scripts/build_cloudflare_pages.sh`
- Build output directory: `_site`
- Production branch: `main`

Why this setup:

- The site is static, so Cloudflare Pages does not need Node, npm, SSH, SFTP or rsync.
- The build script publishes only public website files: `index.html`, `css`, `js`, `img`, `content`, `admin`, `_headers` and `_redirects` if present.
- GitHub Actions continue to update JSON content in the repository. Cloudflare Pages deploys only when those Actions actually commit changes.

Recommended build watch paths in Cloudflare Pages:

Include paths:

```text
index.html
css/*
js/*
img/*
content/*
admin/*
_headers
_redirects
```

Exclude paths:

```text
.github/*
scripts/*
README.md
README-CLOUDFLARE-PAGES.md
requirements-sportrentino.txt
run_import_sportrentino.bat
```

After Cloudflare Pages is live, keep the VHosting deploy workflow only as a manual fallback.
