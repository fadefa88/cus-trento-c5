# CUS Trento C5 Website

Official website project for **CUS Trento C5**, a futsal club based in Trento, Italy.

The site is a lightweight static frontend with structured JSON content, Decap CMS editing, and GitHub Actions for deployment and recurring data updates.

## Main structure

```text
.
├── index.html
├── css/style.css
├── js/app.js
├── admin/
│   ├── index.html
│   ├── config.yml
│   └── custom.js
├── content/
│   ├── data.json
│   ├── cms/
│   │   ├── news.json
│   │   ├── roster.json
│   │   ├── fixtures.json
│   │   ├── u21-fixtures.json
│   │   ├── gallery-albums.json
│   │   ├── sponsors.json
│   │   ├── sponsor-packages.json
│   │   ├── staff.json
│   │   ├── videos.json
│   │   └── club-history.json
│   ├── news.index.json
│   ├── news.imported.json
│   └── social-feed.json
├── img/
│   ├── uploads/
│   └── social/
├── scripts/
└── .github/workflows/
```

## Frontend

The public site is rendered client-side by `js/app.js`. It first loads `content/data.json` as the stable base, then overlays the editable files in `content/cms/*.json`.

Routes are hash based, for example:

```text
/#home
/#squad
/#calendar
/#standings
/#cup
/#stats
/#news
/#gallery
/#social
/#contacts
```

## CMS

Decap CMS is configured in:

```text
admin/config.yml
```

Editable content is stored in isolated JSON files under:

```text
content/cms/
```

This protects `content/data.json` from being rewritten incorrectly by the CMS.

## Images

CMS uploads go to:

```text
img/uploads
```

The workflow below converts uploaded images to WebP and resizes them according to their usage:

```text
scripts/optimize_cms_images.py
.github/workflows/optimize-cms-images.yml
```

Current profiles:

* players and staff: 800×1000, cover crop, quality 82
* news: max width 1600, quality 82
* gallery: max width 1600, quality 80
* sponsors: max width 300, quality 90

## Roster dropdown sync

The CMS match dropdowns are generated from `content/cms/roster.json` by:

```text
scripts/sync_roster_options.py
.github/workflows/sync-roster-options.yml
```

When the roster changes, the workflow updates the player options in `admin/config.yml`.

## News

News uses two levels:

```text
content/cms/news.json       # manual CMS news
content/news.index.json     # lightweight imported-news index
content/news.imported.json  # full imported archive, loaded only when needed
```

Manual news can include text/image blocks through the CMS.

## Standings and imports

Scheduled workflows update external data:

```text
.github/workflows/update-standings.yml
.github/workflows/import-sportrentino-news.yml
.github/workflows/update-instagram-feed.yml
```

The scripts are in `scripts/`.

## Contact form

The contact form is static and posts to Web3Forms from the frontend. The fallback recipient email is configured in `js/app.js`.

There is no PHP contact endpoint in this repository.

## Deployment

Deployment is handled by:

```text
.github/workflows/deploy.yml
```

Sensitive values such as SSH credentials, tokens and deployment paths must be stored only in GitHub Secrets.

## Production checklist

Before going live:

* validate JSON files under `content/`
* validate `admin/config.yml`
* run `node --check js/app.js`
* verify that required static assets are present in the repository or already present on the production host
* verify that `/oldsite` references have been migrated before deleting `/oldsite`
* verify GitHub Actions secrets: `GH_PAT`, `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_PORT`, `SSH_USER`, `SSH_TARGET_DIR`

## Security notes

This repository is public. Do not commit passwords, private keys, SMTP credentials, personal tokens or server credentials. Use GitHub Secrets for automation.
