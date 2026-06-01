#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests


DEFAULT_FEED_URL = "https://rss.app/feeds/v1.1/ZARGBanc4ELDomJR.json"
DEFAULT_THUMBNAIL = "https://custrentocalcioa5.it/oldsite/wp-content/uploads/2026/01/1.-CUS-Trento-C5-scaled.png"


IMAGE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; CUS-Trento-C5-SocialFeedUpdater/1.0)",
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Referer": "https://www.instagram.com/",
}


FEED_HEADERS = {
    "User-Agent": "CUS-Trento-C5-SocialFeedUpdater/1.0",
    "Accept": "application/feed+json, application/json, */*",
}


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
    response = requests.get(feed_url, timeout=30, headers=FEED_HEADERS)
    response.raise_for_status()
    return response.json()


def clean_text(value: str) -> str:
    value = html.unescape(value or "")
    value = re.sub(r"\s+", " ", value).strip()
    return value


def image_extension(url: str, content_type: str = "") -> str:
    ctype = (content_type or "").lower().split(";", 1)[0].strip()
    if ctype == "image/png":
        return ".png"
    if ctype == "image/webp":
        return ".webp"
    if ctype == "image/gif":
        return ".gif"
    if ctype in {"image/jpeg", "image/jpg"}:
        return ".jpg"

    path = urlparse(url).path.lower()
    for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        if path.endswith(ext):
            return ".jpg" if ext == ".jpeg" else ext
    return ".jpg"


def local_image_path_for(post_url: str, image_url: str, content_type: str = "") -> Path:
    digest_source = post_url or image_url
    digest = hashlib.sha1(digest_source.encode("utf-8", errors="ignore")).hexdigest()[:16]
    return Path("img/social") / f"instagram-{digest}{image_extension(image_url, content_type)}"


def to_site_path(path: Path) -> str:
    return "/" + path.as_posix().lstrip("/")


def download_image(image_url: str, post_url: str, repo_root: Path, existing_local_image: str = "") -> tuple[str, str]:
    """
    Downloads a remote Instagram/RSS image into img/social and returns:
    - public site path, for example /img/social/instagram-xxxx.jpg
    - original remote image URL

    If download fails, keeps a previous local image for the same post if available;
    otherwise falls back to DEFAULT_THUMBNAIL.
    """
    image_url = html.unescape(image_url or "").strip()
    if not image_url or image_url == DEFAULT_THUMBNAIL:
        return existing_local_image or DEFAULT_THUMBNAIL, image_url

    if existing_local_image and existing_local_image.startswith("/img/social/"):
        existing_file = repo_root / existing_local_image.lstrip("/")
        if existing_file.exists() and existing_file.stat().st_size > 0:
            return existing_local_image, image_url

    try:
        with requests.get(image_url, timeout=45, headers=IMAGE_HEADERS, stream=True) as response:
            response.raise_for_status()
            content_type = response.headers.get("Content-Type", "")
            if content_type and not content_type.lower().startswith("image/"):
                raise ValueError(f"unexpected content type: {content_type}")

            relative_path = local_image_path_for(post_url, image_url, content_type)
            output_path = repo_root / relative_path
            output_path.parent.mkdir(parents=True, exist_ok=True)

            max_bytes = 10 * 1024 * 1024
            total = 0
            with output_path.open("wb") as f:
                for chunk in response.iter_content(chunk_size=64 * 1024):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > max_bytes:
                        raise ValueError("image too large")
                    f.write(chunk)

            if output_path.stat().st_size <= 0:
                raise ValueError("empty image file")

            return to_site_path(relative_path), image_url
    except Exception as exc:
        print(f"WARN: image download failed for {post_url or image_url}: {exc}", flush=True)
        return existing_local_image or DEFAULT_THUMBNAIL, image_url


def extract_remote_image(item: dict) -> str:
    image = item.get("image") or ""
    if image:
        return html.unescape(str(image))

    attachments = item.get("attachments") or []
    for attachment in attachments:
        if isinstance(attachment, dict) and attachment.get("url"):
            return html.unescape(str(attachment["url"]))

    return ""


def normalize_item(item: dict, index: int, repo_root: Path, existing_by_url: dict[str, dict]) -> dict:
    post_url = html.unescape(str(item.get("url") or item.get("external_url") or "")).strip()
    remote_image = extract_remote_image(item)

    existing = existing_by_url.get(post_url, {}) if post_url else {}
    existing_local_image = str(existing.get("image") or existing.get("thumbnail") or "")
    if existing_local_image.startswith("http"):
        existing_local_image = ""

    local_image, original_image = download_image(
        image_url=remote_image,
        post_url=post_url,
        repo_root=repo_root,
        existing_local_image=existing_local_image,
    )

    text = clean_text(
        item.get("content_text")
        or item.get("summary")
        or item.get("title")
        or "Post Instagram"
    )

    title = clean_text(item.get("title") or text or "Post Instagram")
    if len(title) > 120:
        title = title[:117].rstrip() + "..."

    published = str(item.get("date_published") or item.get("date_modified") or "")

    return {
        "id": f"instagram-{item.get('id') or hashlib.sha1((post_url or str(index)).encode()).hexdigest()[:12]}",
        "platform": "Instagram",
        "source": "rss.app",
        "username": "@custrentoc5",
        "handle": "@custrentoc5",
        "title": title,
        "text": text,
        "caption": text,
        "url": post_url,
        "permalink": post_url,
        "image": local_image,
        "thumbnail": local_image,
        "remoteImage": original_image,
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

    repo_root = Path.cwd()
    feed_path = repo_root / args.feed
    existing_payload = load_json(feed_path, {"updatedAt": "", "posts": []})
    old_posts, output_as_list = existing_posts(existing_payload)

    existing_by_url = {
        str(item.get("url") or item.get("permalink") or ""): item
        for item in old_posts
        if item.get("url") or item.get("permalink")
    }

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
        normalized = normalize_item(item, index, repo_root, existing_by_url)
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
        new_payload.pop("items", None)

    before = json.dumps(existing_payload, ensure_ascii=False, sort_keys=True)
    after = json.dumps(new_payload, ensure_ascii=False, sort_keys=True)

    if before == after:
        print("No social feed changes.")
        return 0

    save_json(feed_path, new_payload)

    print(f"Imported Instagram posts: {len(instagram_posts)}")
    print(f"Total social feed posts now: {len(new_posts)}")
    print("Images saved under img/social when available.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
