#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


DEFAULT_FEED_URL = "https://rss.app/feeds/v1.1/ZARGBanc4ELDomJR.json"
DEFAULT_THUMBNAIL = "https://custrentocalcioa5.it/oldsite/wp-content/uploads/2026/01/1.-CUS-Trento-C5-scaled.png"


def load_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def save_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def fetch_rss_app_json(feed_url: str) -> dict:
    response = requests.get(
        feed_url,
        timeout=30,
        headers={
            "User-Agent": "CUS-Trento-C5-SocialFeedUpdater/1.0",
            "Accept": "application/feed+json, application/json, */*",
        },
    )
    response.raise_for_status()
    return response.json()


def normalize_item(item: dict, index: int) -> dict:
    post_url = item.get("url") or item.get("external_url") or ""
    image = item.get("image") or ""

    if not image:
        attachments = item.get("attachments") or []
        for attachment in attachments:
            if isinstance(attachment, dict) and attachment.get("url"):
                image = attachment["url"]
                break

    text = (
        item.get("content_text")
        or item.get("summary")
        or item.get("title")
        or "Post Instagram"
    ).strip()

    title = (item.get("title") or text or "Post Instagram").strip()
    if len(title) > 120:
        title = title[:117].rstrip() + "..."

    published = item.get("date_published") or item.get("date_modified") or ""

    return {
        "id": f"instagram-{item.get('id') or index}",
        "platform": "Instagram",
        "source": "rss.app",
        "username": "@custrentoc5",
        "handle": "@custrentoc5",
        "title": title,
        "text": text,
        "caption": text,
        "url": post_url,
        "permalink": post_url,
        "image": image or DEFAULT_THUMBNAIL,
        "thumbnail": image or DEFAULT_THUMBNAIL,
        "date": published[:10] if published else "",
        "publishedAt": published,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "importedFrom": "rss.app",
        "placeholder": False,
    }


def existing_posts(payload: Any) -> tuple[list[dict], bool]:
    if isinstance(payload, list):
        return payload, True
    if isinstance(payload, dict):
        if isinstance(payload.get("posts"), list):
            return payload["posts"], False
        if isinstance(payload.get("items"), list):
            return payload["items"], False
    return [], False


def merge_instagram_posts(existing: list[dict], instagram_posts: list[dict]) -> list[dict]:
    non_instagram = [
        item for item in existing
        if str(item.get("platform") or item.get("source") or "").lower() != "instagram"
    ]

    merged = instagram_posts + non_instagram

    seen = set()
    unique = []
    for item in merged:
        key = item.get("url") or item.get("permalink") or item.get("id")
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(item)

    return unique


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--feed-url", default=DEFAULT_FEED_URL)
    parser.add_argument("--feed", default="content/social-feed.json")
    parser.add_argument("--limit", type=int, default=4)
    args = parser.parse_args()

    feed_path = Path(args.feed)
    existing_payload = load_json(feed_path, {"updatedAt": "", "posts": []})
    old_posts, output_as_list = existing_posts(existing_payload)

    print(f"Existing social feed posts: {len(old_posts)}")
    print(f"Reading Instagram JSON feed: {args.feed_url}")

    try:
        payload = fetch_rss_app_json(args.feed_url)
    except Exception as exc:
        print(f"WARN: failed to fetch RSS.app JSON feed: {exc}", flush=True)
        print("Keeping existing social-feed.json unchanged.")
        return 0

    raw_items = payload.get("items") or []
    print(f"RSS.app items found: {len(raw_items)}")

    instagram_posts = []
    for index, item in enumerate(raw_items[: args.limit], start=1):
        normalized = normalize_item(item, index)
        if normalized.get("url"):
            instagram_posts.append(normalized)

    if not instagram_posts:
        print("WARN: no usable Instagram posts found. Keeping existing feed unchanged.")
        return 0

    new_posts = merge_instagram_posts(old_posts, instagram_posts)

    if output_as_list:
        new_payload = new_posts
    else:
        new_payload = {
            **(existing_payload if isinstance(existing_payload, dict) else {}),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "instagramFeedUrl": args.feed_url,
            "posts": new_posts,
        }
        # Avoid a parallel items array: the frontend reads posts.
        new_payload.pop("items", None)

    before = json.dumps(existing_payload, ensure_ascii=False, sort_keys=True)
    after = json.dumps(new_payload, ensure_ascii=False, sort_keys=True)

    if before == after:
        print("No social feed changes.")
        return 0

    save_json(feed_path, new_payload)

    print(f"Imported Instagram posts: {len(instagram_posts)}")
    print(f"Total social feed posts now: {len(new_posts)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
