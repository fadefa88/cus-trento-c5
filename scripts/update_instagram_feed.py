#!/usr/bin/env python3
"""
Best-effort Instagram public scraper for CUS Trento C5.

It updates only Instagram items in content/social-feed.json.
No login, no tokens, no credential handling.

Important:
- This is intentionally best-effort. Instagram can block/rate-limit public scraping.
- If scraping fails, the script preserves the existing JSON and exits without breaking the site.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import requests
from bs4 import BeautifulSoup

DEFAULT_THUMB = "https://custrentocalcioa5.it/oldsite/wp-content/uploads/2026/01/1.-CUS-Trento-C5-scaled.png"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"WARN: cannot read {path}: {exc}", flush=True)
        return default


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def payload_posts(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict) and isinstance(payload.get("posts"), list):
        return [x for x in payload["posts"] if isinstance(x, dict)]
    return []


def load_existing_posts(feed_path: Path, data_path: Path) -> list[dict]:
    payload = read_json(feed_path, {"posts": []})
    posts = payload_posts(payload)
    if posts:
        return posts

    data = read_json(data_path, {})
    legacy = data.get("social", []) if isinstance(data, dict) else []
    out = []
    for i, item in enumerate(legacy):
        if not isinstance(item, dict):
            continue
        network = item.get("network") or item.get("platform") or ""
        if not re.search(r"instagram|tiktok", str(network), re.I):
            continue
        out.append({
            "id": item.get("id") or f"legacy-{i}",
            "platform": "TikTok" if re.search(r"tiktok", str(network), re.I) else "Instagram",
            "username": item.get("handle") or "@custrentoc5",
            "url": item.get("url") or "",
            "caption": item.get("text") or item.get("caption") or "",
            "date": item.get("date") or "",
            "thumbnail": item.get("thumbnail") or DEFAULT_THUMB,
            "source": "legacy"
        })
    return out


def normalize_caption(text: str, max_len: int = 220) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) > max_len:
        text = text[: max_len - 1].rstrip() + "…"
    return text


def iso_from_datetime(dt: Any) -> str:
    if not dt:
        return ""
    try:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).date().isoformat()
    except Exception:
        return ""


def post_item(shortcode: str, username: str, caption: str = "", date: str = "", thumbnail: str = "", source: str = "instagram-public") -> dict:
    shortcode = str(shortcode or "").strip()
    return {
        "id": f"instagram-{shortcode}",
        "platform": "Instagram",
        "username": f"@{username}",
        "url": f"https://www.instagram.com/p/{shortcode}/" if shortcode else f"https://www.instagram.com/{username}/",
        "caption": normalize_caption(caption) or "Post Instagram CUS Trento C5.",
        "date": date or "",
        "thumbnail": thumbnail or DEFAULT_THUMB,
        "source": source,
        "fetchedAt": now_iso()
    }


def scrape_with_instaloader(username: str, limit: int) -> list[dict]:
    """
    Uses Instaloader without login. It may be rate-limited by Instagram.
    """
    try:
        import instaloader  # type: ignore
    except Exception as exc:
        print(f"WARN: instaloader not available: {exc}", flush=True)
        return []

    try:
        loader = instaloader.Instaloader(
            download_pictures=False,
            download_videos=False,
            download_video_thumbnails=False,
            download_geotags=False,
            download_comments=False,
            save_metadata=False,
            compress_json=False,
            quiet=True,
            user_agent="Mozilla/5.0 (compatible; CUSTrentoC5Bot/1.0; +https://custrentocalcioa5.it)"
        )
        profile = instaloader.Profile.from_username(loader.context, username)
        posts: list[dict] = []
        for post in profile.get_posts():
            shortcode = getattr(post, "shortcode", "")
            caption = getattr(post, "caption", "") or ""
            date = iso_from_datetime(getattr(post, "date_utc", None))
            thumbnail = getattr(post, "url", "") or DEFAULT_THUMB
            if shortcode:
                posts.append(post_item(shortcode, username, caption, date, thumbnail, "instaloader-public"))
            if len(posts) >= limit:
                break
        return dedupe_instagram(posts)[:limit]
    except Exception as exc:
        print(f"WARN: instaloader scraping failed: {exc}", flush=True)
        return []


def scrape_from_instagram_html(username: str, limit: int) -> list[dict]:
    """
    Attempts to parse public page HTML. This often fails because Instagram changes markup
    and may require login/JS, but it is safe as a fallback.
    """
    url = f"https://www.instagram.com/{username}/"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
    }
    try:
        res = requests.get(url, headers=headers, timeout=30)
        res.raise_for_status()
        html = res.text
    except Exception as exc:
        print(f"WARN: instagram HTML fetch failed: {exc}", flush=True)
        return []

    posts: list[dict] = []

    # Common shortcode patterns in embedded JSON.
    for shortcode in re.findall(r'"shortcode"\s*:\s*"([^"]+)"', html):
        posts.append(post_item(shortcode, username, source="instagram-html-shortcode"))
        if len(posts) >= limit:
            return dedupe_instagram(posts)[:limit]

    # Permalink patterns.
    for shortcode in re.findall(r'instagram\.com/p/([A-Za-z0-9_-]+)/?', html):
        posts.append(post_item(shortcode, username, source="instagram-html-link"))
        if len(posts) >= limit:
            return dedupe_instagram(posts)[:limit]

    # Try JSON-LD/meta caption only as profile-level fallback.
    soup = BeautifulSoup(html, "html.parser")
    desc = ""
    meta = soup.find("meta", attrs={"name": "description"})
    if meta and meta.get("content"):
        desc = str(meta.get("content"))
    if posts and desc:
        for p in posts:
            p["caption"] = normalize_caption(desc)

    return dedupe_instagram(posts)[:limit]


def scrape_from_public_oembed_like(username: str, limit: int) -> list[dict]:
    """
    Very conservative placeholder for public mirrors is intentionally not used.
    We avoid third-party mirror scraping by default to keep the workflow cleaner.
    """
    return []


def dedupe_instagram(posts: list[dict]) -> list[dict]:
    seen = set()
    out = []
    for p in posts:
        key = p.get("url") or p.get("id")
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def fetch_instagram_posts(username: str, limit: int) -> list[dict]:
    methods = [
        ("instaloader", scrape_with_instaloader),
        ("instagram_html", scrape_from_instagram_html),
        ("public_oembed_like", scrape_from_public_oembed_like),
    ]
    for name, fn in methods:
        print(f"Trying Instagram method: {name}", flush=True)
        posts = fn(username, limit)
        if posts:
            print(f"Method {name} found {len(posts)} Instagram post(s).", flush=True)
            return posts[:limit]
    print("WARN: no Instagram posts found. Existing feed will be preserved.", flush=True)
    return []


def merge_posts(existing: list[dict], instagram_posts: list[dict], instagram_limit: int) -> list[dict]:
    # Replace Instagram items only if we successfully fetched new Instagram posts.
    if instagram_posts:
        non_instagram = [p for p in existing if str(p.get("platform", "")).lower() != "instagram"]
        merged = instagram_posts[:instagram_limit] + non_instagram
    else:
        merged = existing

    # Stable order: Instagram first, then TikTok, then any other supported platform.
    def key(p: dict) -> tuple[int, str]:
        platform = str(p.get("platform", "")).lower()
        rank = 0 if platform == "instagram" else 1 if platform == "tiktok" else 2
        return (rank, str(p.get("date", "")))

    # Keep current order within platform for API-returned recency.
    return merged


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", default="custrentoc5")
    parser.add_argument("--limit", type=int, default=2)
    parser.add_argument("--feed", default="content/social-feed.json")
    parser.add_argument("--data", default="content/data.json")
    args = parser.parse_args()

    feed_path = Path(args.feed)
    data_path = Path(args.data)
    existing = load_existing_posts(feed_path, data_path)

    print(f"Existing social feed items: {len(existing)}", flush=True)
    instagram_posts = fetch_instagram_posts(args.username, args.limit)

    if not instagram_posts and feed_path.exists():
        print("No new Instagram data. Keeping existing social-feed.json unchanged.", flush=True)
        return 0

    merged = merge_posts(existing, instagram_posts, args.limit)

    payload = {
        "updatedAt": now_iso() if instagram_posts else "",
        "source": "instagram-public-best-effort",
        "warning": "Instagram scraping without tokens is best-effort and can fail if Instagram changes or blocks public access.",
        "posts": merged
    }
    write_json(feed_path, payload)

    print(f"Written {feed_path} with {len(merged)} item(s).", flush=True)
    print(f"Instagram items written: {len([p for p in merged if str(p.get('platform','')).lower()=='instagram'])}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
