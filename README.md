# CUS Trento C5 Website

Official website project for **CUS Trento C5**, a futsal club based in Trento, Italy.

The project is a lightweight static website built with plain HTML, CSS and JavaScript.
It uses structured JSON content, Decap CMS for editorial updates, and GitHub Actions for deployment, image optimization and recurring data imports.

The repository is public, so no credentials, tokens, private server paths or sensitive operational details should be committed.

## Project structure

```text
.
├── index.html
├── css/
│   └── style.css
├── js/
│   └── app.js
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
└── .github/
    └── workflows/
```

## Frontend

The public website is rendered client-side by:

```text
js/app.js
```

The app first loads:

```text
content/data.json
```

as the stable base dataset, then overlays the editable CMS files stored under:

```text
content/cms/
```

The site uses hash-based routing, for example:

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

There is no server-side rendering and no database dependency.

## CMS

The editorial backend is powered by Decap CMS and is configured in:

```text
admin/config.yml
```

Most editable content is stored in isolated JSON files under:

```text
content/cms/
```

This avoids unnecessary rewrites of the main `content/data.json` file and makes CMS updates safer.

Typical CMS-managed content includes:

* manual news
* roster
* fixtures
* U21 fixtures
* gallery albums
* sponsors
* sponsor packages
* staff
* videos
* club history

## News system

News content is split into manual and imported sources:

```text
content/cms/news.json       # manually created CMS news
content/news.index.json     # lightweight imported-news index
content/news.imported.json  # full imported-news archive
```

Manual news can be edited from the CMS and may include structured text and image blocks.

Imported news are handled separately to keep the frontend fast and avoid loading the full archive unless needed.

## Social feed

The social feed is stored in:

```text
content/social-feed.json
```

and is updated by:

```text
scripts/update_instagram_feed.py
.github/workflows/update-instagram-feed.yml
```

The script normalizes external social content before publishing it to the site.
It removes unwanted metadata fragments such as usernames, dates, counters and share labels that may appear in embedded social widgets.

Downloaded social images are stored under:

```text
img/social/
```

## Images

CMS uploads are stored in:

```text
img/uploads/
```

Uploaded images are optimized by:

```text
scripts/optimize_cms_images.py
.github/workflows/optimize-cms-images.yml
```

Current optimization profiles:

* players and staff: 800×1000, cover crop, quality 82
* news: max width 1600, quality 82
* gallery: max width 1600, quality 80
* sponsors: max width 300, quality 90

## Roster dropdown sync

CMS match dropdowns are generated from:

```text
content/cms/roster.json
```

by:

```text
scripts/sync_roster_options.py
.github/workflows/sync-roster-options.yml
```

When the roster changes, the workflow updates player options inside:

```text
admin/config.yml
```

This keeps match editing easier and reduces manual mistakes when selecting players or scorers.

## Standings and external imports

Some data is updated automatically through scheduled GitHub Actions.

Main workflows:

```text
.github/workflows/update-standings.yml
.github/workflows/import-sportrentino-news.yml
.github/workflows/update-instagram-feed.yml
```

Related scripts are stored in:

```text
scripts/
```

These workflows update external standings, imported news and social feed content.

## Contact form

The contact form is static and posts from the frontend through Web3Forms.

There is no PHP contact endpoint in this repository.

The fallback recipient configuration is handled in:

```text
js/app.js
```

Do not commit private form keys or sensitive email configuration directly to the repository.

## Deployment

Deployment is handled by:

```text
.github/workflows/deploy.yml
```

Sensitive values such as SSH credentials, tokens, deployment paths and private keys must be stored only in GitHub Secrets.

Expected secret names may include:

```text
GH_PAT
SSH_PRIVATE_KEY
SSH_HOST
SSH_PORT
SSH_USER
SSH_TARGET_DIR
```

The exact production configuration should remain outside the public repository.

## Maintenance checklist

Before deploying relevant changes:

```bash
node --check js/app.js
```

Also verify:

* JSON files under `content/`
* CMS configuration in `admin/config.yml`
* required images and static assets
* GitHub Actions status
* deployment secrets
* imported content format
* social feed output
* contact form behavior

When changing only content files, a full frontend code review is usually not required.
When changing `js/app.js`, `admin/config.yml`, workflows or scripts, validate carefully before deploying.

## Production checklist

Before going live or making major changes:

* validate all JSON files under `content/`
* validate `admin/config.yml`
* run `node --check js/app.js`
* verify that required static assets are present in the repository or already present on the production host
* verify that old `/oldsite` references have been migrated before deleting legacy folders
* verify GitHub Actions secrets
* verify social feed generation
* verify standings update
* verify contact form submission
* verify mobile navigation
* verify main routes and deep links

## Security notes

This repository is public.

Do not commit:

* passwords
* private keys
* SMTP credentials
* API tokens
* personal access tokens
* private server paths
* private deployment details
* sensitive personal data

Use GitHub Secrets for automation and deployment configuration.

## Technology summary

This project intentionally keeps the stack simple:

* static HTML
* CSS
* vanilla JavaScript
* JSON content files
* Decap CMS
* GitHub Actions
* external static hosting

The goal is to keep the website easy to maintain, fast to load and independent from a traditional backend or database.
