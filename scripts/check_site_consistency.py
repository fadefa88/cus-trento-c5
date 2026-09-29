#!/usr/bin/env python3
"""Consistency checks between the layers that cannot share code.

js/site-core.js is authoritative for routes, collections and slug rules; the
Python port lives in scripts/site_data.py. This check fails when:

- the CMS files declared in admin/config.yml and content/cms/*.json diverge,
  or two CMS files define the same top-level key;
- the Python port and js/site-core.js (run with node) disagree on any slug, ID,
  URL or text rule for the current content;
- a JS file outside js/site-core.js re-declares the shared rule tables.

Requires node on PATH (preinstalled on GitHub-hosted runners).
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

from site_data import (
    COLLECTIONS,
    CONFIG,
    ROOT,
    cms_files,
    is_hidden_news,
    item_path,
    load_site_data,
    merged_site_data,
    public_youth_text,
    season_competition,
    slug_fields,
    with_ids_and_slugs,
)

NODE_SCRIPT = r"""
const fs = require("fs");
const vm = require("vm");
vm.runInThisContext(fs.readFileSync(process.argv[1], "utf8"));
const S = globalThis.CUS_SITE;
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const out = {paths: {}, ids: {}, seasons: {}, youth: {}, hidden: {}};
for (const [key, items] of Object.entries(input.collections)) {
  out.paths[key] = items.map(item => S.itemPath(key, item));
  out.ids[key] = S.computeIdsAndSlugs(items, S.config.collections[key].slugFields);
}
for (const s of input.seasons) out.seasons[s] = S.seasonCompetition(s);
for (const t of input.texts) out.youth[t] = S.publicYouthText(t);
out.hidden = input.news.map(n => S.isHiddenNews(n));
process.stdout.write(JSON.stringify(out));
"""

errors: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


def check_cms_files() -> None:
    declared = set(cms_files())
    on_disk = {p.relative_to(ROOT).as_posix() for p in (ROOT / "content" / "cms").glob("*.json")}
    for rel in sorted(on_disk - declared):
        fail(f"{rel} exists but is not declared in admin/config.yml (it would never be merged)")
    for rel in sorted(declared - on_disk):
        fail(f"admin/config.yml declares {rel} but the file does not exist")
    merged_site_data()  # raises on duplicate top-level keys


def check_js_parity() -> None:
    data = load_site_data()
    collections = {key: [i for i in data.get(key, []) if isinstance(i, dict)] for key in COLLECTIONS if isinstance(data.get(key), list)}
    # Also feed the raw (pre-normalization) lists so ID/slug assignment itself is compared.
    raw = merged_site_data()
    raw_lists = {key: [i for i in raw.get(key, []) if isinstance(i, dict)] for key in COLLECTIONS if isinstance(raw.get(key), list)}
    seasons = sorted(set(CONFIG["seasonCompetitions"]) | {"2014/15", "2026/27", "1999/2000", "", "2025 / 2026"})
    texts = ["Under 21", "under21", "U21 Cup", "Coppa Under 21", "Prima squadra", "u212"]

    payload = {"collections": collections, "seasons": seasons, "texts": texts, "news": data.get("news", [])}
    result = subprocess.run(
        ["node", "-e", NODE_SCRIPT, str(ROOT / "js" / "site-core.js")],
        input=json.dumps(payload), capture_output=True, text=True, encoding="utf-8",
    )
    if result.returncode != 0:
        fail(f"node failed to evaluate js/site-core.js: {result.stderr.strip()}")
        return
    js = json.loads(result.stdout)

    for key, items in collections.items():
        py_paths = [item_path(key, item) for item in items]
        for i, (a, b) in enumerate(zip(py_paths, js["paths"][key])):
            if a != b:
                fail(f"URL mismatch for {key}[{i}]: python {a} != js {b}")
                break

    raw_payload = {"collections": raw_lists, "seasons": [], "texts": [], "news": []}
    raw_js = json.loads(subprocess.run(
        ["node", "-e", NODE_SCRIPT, str(ROOT / "js" / "site-core.js")],
        input=json.dumps(raw_payload), capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout)
    for key, items in raw_lists.items():
        py = [{"id": str(i["id"]), "slug": i["slug"]} for i in with_ids_and_slugs(items, slug_fields(key))]
        jsv = [{"id": str(i["id"]), "slug": i["slug"]} for i in raw_js["ids"][key]]
        if py != jsv:
            first = next(n for n, (a, b) in enumerate(zip(py, jsv)) if a != b)
            fail(f"ID/slug assignment mismatch for {key}[{first}]: python {py[first]} != js {jsv[first]}")

    for season in seasons:
        if season_competition(season) != js["seasons"][season]:
            fail(f"seasonCompetition({season!r}): python {season_competition(season)!r} != js {js['seasons'][season]!r}")
    for text in texts:
        if public_youth_text(text) != js["youth"][text]:
            fail(f"publicYouthText({text!r}): python {public_youth_text(text)!r} != js {js['youth'][text]!r}")
    py_hidden = [is_hidden_news(n) for n in data.get("news", [])]
    if py_hidden != js["hidden"]:
        fail("isHiddenNews disagrees between python and js")


def check_no_redeclared_rules() -> None:
    pattern = re.compile(r"\b(AUTO_OBJECT_FIELDS|HIDDEN_NEWS_TITLES|ITEM_URL_BASES)\s*=")
    for path in [*(ROOT / "js").glob("*.js"), ROOT / "admin" / "custom.js", ROOT / "index.html"]:
        if path.name == "site-core.js":
            continue
        if pattern.search(path.read_text(encoding="utf-8")):
            fail(f"{path.relative_to(ROOT).as_posix()} re-declares a rule table owned by js/site-core.js")


def check_routes() -> None:
    paths = [page["path"] for page in CONFIG["pages"]]
    if len(paths) != len(set(paths)):
        fail("duplicate page paths in js/site-core.js pages")
    routes = {page["route"] for page in CONFIG["pages"]}
    for alias, target in CONFIG["routeAliases"].items():
        if target not in routes:
            fail(f"route alias {alias} -> {target} points to an unknown route")
    for redirect in CONFIG["redirects"]:
        if redirect["to"] not in paths:
            fail(f"redirect {redirect['from']} -> {redirect['to']} targets a path without a page")
        if redirect["from"] in paths:
            fail(f"redirect source {redirect['from']} is also a prerendered page")


def main() -> int:
    check_cms_files()
    check_routes()
    check_no_redeclared_rules()
    check_js_parity()
    if errors:
        print("Site consistency check FAILED:", file=sys.stderr)
        for message in errors:
            print(f"  - {message}", file=sys.stderr)
        return 1
    print(f"Site consistency OK: {len(cms_files())} CMS files, {len(CONFIG['pages'])} pages, {len(COLLECTIONS)} collections checked against js/site-core.js")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
