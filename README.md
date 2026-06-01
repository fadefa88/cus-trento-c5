# CUS Trento C5 Website

Official website project for **CUS Trento C5**, a futsal club based in Trento, Italy.

The site is built as a lightweight static frontend with structured JSON content, automated data updates and a small server-side contact endpoint.

## Overview

This repository contains the public website source code for CUS Trento C5.

The website includes:

* Home page
* Club information
* First team and Under 21 squad pages
* Match calendar
* League standings
* Cup section
* Player statistics
* Historical statistics
* News section
* Gallery
* Social feed
* Resources
* Contact form

The frontend is mostly static and reads structured content from JSON files stored in the repository.

## Project Structure

```text
.
├── index.html
├── css/
│   └── style.css
├── js/
│   └── app.js
├── content/
│   ├── data.json
│   ├── news.imported.json
│   └── social-feed.json
├── img/
│   └── social/
├── admin/
│   └── config.yml
├── api/
│   └── contact.php
├── scripts/
│   ├── import_sportrentino_news.py
│   ├── update_standings.py
│   └── update_instagram_feed.py
└── .github/
    └── workflows/
```

## Frontend

The website is rendered client-side using:

* `index.html`
* `css/style.css`
* `js/app.js`

The JavaScript file loads the content from JSON files and renders the different sections of the website based on the current URL hash, for example:

```text
/#home
/#squad
/#calendar
/#standings
/#news
/#social
/#contacts
```

## Content Management

Most editable content is stored in:

```text
content/data.json
```

This file contains the main website data, such as:

* players
* fixtures
* standings
* staff
* sponsors
* gallery albums
* resources
* historical statistics
* manual news

The CMS configuration is stored in:

```text
admin/config.yml
```

The CMS is intended to make routine content updates easier without editing the JSON manually.

## News System

The news section is split into two sources:

```text
content/data.json
content/news.imported.json
```

`content/data.json` contains manually created or newly managed news items.

`content/news.imported.json` contains imported historical news that are not intended to be edited manually in the CMS.

At runtime, the frontend merges both sources and displays them together in the news section.

The news page also supports:

* category filtering
* text search
* individual article pages
* share buttons for common platforms
* native sharing where supported by the browser

## Standings Automation

League standings are updated by a scheduled GitHub Actions workflow.

The update process is handled by:

```text
scripts/update_standings.py
.github/workflows/update-standings.yml
```

The script reads the public league tables from the configured external source and updates:

```text
content/data.json
```

Specifically:

* `standings` for the First Team
* `u21Standings` for the Under 21 team

The workflow only commits changes when the standings data has actually changed.

## Social Feed

The social feed is stored in:

```text
content/social-feed.json
```

The frontend uses this file to show social cards on the home page and on the dedicated social page.

Images used by the social feed can be cached locally under:

```text
img/social/
```

This avoids depending directly on temporary third-party CDN image URLs.

## Contact Form

The contact page uses a server-side PHP endpoint:

```text
api/contact.php
```

The form is designed to send contact requests by email without requiring a database.

The endpoint includes basic validation and anti-spam checks. Sensitive mail/server configuration should never be committed to the repository.

## GitHub Actions

The repository uses GitHub Actions for automated maintenance tasks, such as:

* updating league standings
* updating social feed data
* deploying the website

Workflow files are stored in:

```text
.github/workflows/
```

Secrets, tokens, server credentials and private deployment values must be configured only through **GitHub Secrets** and must not be committed to the repository.

## Deployment

The site is maintained through GitHub and deployed to the production hosting environment using automated workflows.

The repository intentionally does not expose sensitive deployment details, credentials or tokens.

## Security Notes

This is a public repository. Do not commit:

* passwords
* API tokens
* access tokens
* private keys
* server credentials
* SMTP credentials
* personal account secrets
* raw production configuration containing sensitive values

Use GitHub Secrets for sensitive values required by workflows.

## Development Notes

This project is intentionally lightweight.

There is no full frontend framework and no database dependency for the public site. Most of the website is generated from structured JSON content and rendered in the browser.

Before committing changes, check:

* `content/data.json` is valid JSON
* `content/social-feed.json` is valid JSON
* workflow YAML files keep correct indentation
* JavaScript has no syntax errors
* sensitive values are not present in the codebase

## License

This repository contains the website source code and content for CUS Trento C5. Reuse of club assets, logos, images and editorial content may require permission from the club.
