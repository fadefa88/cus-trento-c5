#!/usr/bin/env python3
"""Single implementation of the site data rules used by every Python tool.

- Site configuration (routes, collections, slug settings) is read from the
  SITE-CONFIG block of js/site-core.js, which the browser uses as well.
- CMS files are discovered from admin/config.yml (the files Decap CMS writes),
  so adding a CMS collection there is enough for every merge to pick it up.
- The CMS merge is: base content/data.json, then each CMS file's top-level
  keys in admin/config.yml order (a CMS key always wins over data.json).

CLI:
  python scripts/site_data.py merge [--root DIR]
      Rewrite DIR/content/data.json with the CMS files merged in (default DIR:
      repository root). Used by the Cloudflare build and the CMS sync workflow.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[1]
SITE_CORE_JS = ROOT / "js" / "site-core.js"
CMS_CONFIG = ROOT / "admin" / "config.yml"

_CONFIG_RE = re.compile(r"/\*SITE-CONFIG-START\*/(.*?)/\*SITE-CONFIG-END\*/", re.S)
_CMS_FILE_RE = re.compile(r"^\s*file:\s*['\"]?(content/cms/[^'\"\s]+\.json)['\"]?\s*$", re.M)


def load_site_config() -> Dict[str, Any]:
    match = _CONFIG_RE.search(SITE_CORE_JS.read_text(encoding="utf-8"))
    if not match:
        raise SystemExit(f"SITE-CONFIG block not found in {SITE_CORE_JS}")
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"SITE-CONFIG block in {SITE_CORE_JS} is not strict JSON: {exc}") from exc


CONFIG = load_site_config()
SITE_URL = CONFIG["siteUrl"].rstrip("/")
COLLECTIONS: Dict[str, Dict[str, Any]] = CONFIG["collections"]


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {path}: {exc}") from exc


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ----- CMS merge ---------------------------------------------------------------

def cms_files() -> List[str]:
    """CMS JSON files in admin/config.yml order (repository-relative paths)."""
    files = _CMS_FILE_RE.findall(CMS_CONFIG.read_text(encoding="utf-8"))
    if not files:
        raise SystemExit(f"No content/cms/*.json files declared in {CMS_CONFIG}")
    return list(dict.fromkeys(files))


def merge_cms(base: Dict[str, Any], root: Path = ROOT) -> Dict[str, Any]:
    data = dict(base) if isinstance(base, dict) else {}
    owner: Dict[str, str] = {}
    for rel in cms_files():
        payload = read_json(root / rel, {})
        if not isinstance(payload, dict):
            continue
        for key, value in payload.items():
            if key in owner:
                raise SystemExit(f"CMS key '{key}' is defined by both {owner[key]} and {rel}")
            owner[key] = rel
            data[key] = value
    return data


def merged_site_data(root: Path = ROOT) -> Dict[str, Any]:
    return merge_cms(read_json(root / "content" / "data.json", {}), root)


# ----- Slugs, IDs and URLs (port of js/site-core.js) ----------------------------

def slugify(value: Any) -> str:
    text = unicodedata.normalize("NFKD", "" if value is None else str(value))
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    text = text[: CONFIG["slug"]["maxLength"]].rstrip("-")
    return text or CONFIG["slug"]["fallback"]


def slug_fields(collection: str) -> List[str]:
    return COLLECTIONS.get(collection, {}).get("slugFields", ["title", "name", "date"])


def slug_base(item: Dict[str, Any], fields: List[str]) -> str:
    direct = " ".join(str(item.get(field)) for field in fields if item.get(field))
    return direct or str(item.get("name") or item.get("title") or item.get("home") or item.get("away") or item.get("date") or item.get("season") or "item")


def unique_slug(base: Any, used: set[str]) -> str:
    root = slugify(base or "item")
    candidate = root
    counter = 2
    while candidate in used:
        candidate = f"{root}-{counter}"
        counter += 1
    used.add(candidate)
    return candidate


def with_ids_and_slugs(items: Any, fields: List[str]) -> Any:
    if not isinstance(items, list):
        return items
    used_ids: set[str] = set()
    used_slugs: set[str] = set()
    normalized: List[Any] = []
    for item in items:
        if not isinstance(item, dict):
            normalized.append(item)
            continue
        out = dict(item)
        current_id = str(out.get("id") or "").strip()
        if current_id and current_id not in used_ids:
            used_ids.add(current_id)
        else:
            out["id"] = unique_slug(current_id or slug_base(out, fields), used_ids)
        current_slug = str(out.get("slug") or "").strip()
        out["slug"] = unique_slug(current_slug or slug_base(out, fields), used_slugs)
        normalized.append(out)
    return normalized


def normalize_collections(data: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(data or {})
    for key, definition in COLLECTIONS.items():
        if isinstance(out.get(key), list):
            out[key] = with_ids_and_slugs(out[key], definition["slugFields"])
    for nested in CONFIG["nestedSlugLists"]:
        obj = out.get(nested["object"])
        if isinstance(obj, dict) and isinstance(obj.get(nested["list"]), list):
            out[nested["object"]] = {**obj, nested["list"]: with_ids_and_slugs(obj[nested["list"]], nested["slugFields"])}
    return out


def object_slug(item: Dict[str, Any], collection: str) -> str:
    return slugify(item.get("slug") or slug_base(item, slug_fields(collection)))


def item_path(collection: str, item: Dict[str, Any]) -> str:
    return f"{COLLECTIONS[collection]['urlBase']}{object_slug(item, collection)}/"


def is_hidden_news(item: Dict[str, Any]) -> bool:
    return str(item.get("title") or "").strip() in CONFIG["hiddenNewsTitles"]


def season_competition(season: Any) -> str:
    """Competition for a season key; "2014/15" and "2014/2015" both resolve."""
    key = re.sub(r"\s", "", str(season or ""))
    long_key = re.sub(r"^(\d{4})/(\d{2})$", lambda m: f"{m.group(1)}/20{m.group(2)}", key)
    return CONFIG["seasonCompetitions"].get(key) or CONFIG["seasonCompetitions"].get(long_key) or ""


def public_youth_text(value: Any) -> str:
    text = re.sub(r"\bunder\s*21\b", "Under 23", str(value or ""), flags=re.I)
    return re.sub(r"\bu21\b", "U23", text, flags=re.I)


# ----- News --------------------------------------------------------------------

def news_key(item: Dict[str, Any]) -> str:
    return str(item.get("sourceUrl") or item.get("sourceId") or item.get("id") or f"{item.get('title')}|{item.get('date')}")


def sort_news(news: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(news, key=lambda n: (str(n.get("date") or ""), int(n.get("id") or 0) if str(n.get("id") or "").isdigit() else 0), reverse=True)


def load_site_data(root: Path = ROOT) -> Dict[str, Any]:
    """Merged data as published, with the imported news archive folded into news."""
    data = normalize_collections(merged_site_data(root))

    imported_index = read_json(root / "content" / "news.index.json", {})
    imported_full = read_json(root / "content" / "news.imported.json", {})
    index_news = imported_index.get("news", []) if isinstance(imported_index, dict) else imported_index if isinstance(imported_index, list) else []
    full_news = imported_full.get("news", []) if isinstance(imported_full, dict) else imported_full if isinstance(imported_full, list) else []
    cms_news = data.get("news", []) if isinstance(data.get("news"), list) else []

    full_by_key = {news_key(item): item for item in full_news if isinstance(item, dict)}
    merged: List[Dict[str, Any]] = []
    seen = set()
    for source in [cms_news, index_news]:
        for item in source:
            if not isinstance(item, dict):
                continue
            key = news_key(item)
            if key in seen:
                continue
            seen.add(key)
            full = full_by_key.get(key)
            merged.append({**item, **full} if full else item)

    data["news"] = with_ids_and_slugs(sort_news(merged), slug_fields("news"))
    return data


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    merge = sub.add_parser("merge", help="Merge content/cms/*.json into content/data.json")
    merge.add_argument("--root", type=Path, default=ROOT, help="Directory containing content/ (default: repository root)")
    args = parser.parse_args(argv)

    if args.command == "merge":
        target = args.root / "content" / "data.json"
        write_json(target, merged_site_data(args.root))
        print(f"Merged {len(cms_files())} CMS files into {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
