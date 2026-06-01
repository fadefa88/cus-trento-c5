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


DEFAULT_INSTAGRAM_FEED_URL = "https://rss.app/feeds/v1.1/ZARGBanc4ELDomJR.json"
DEFAULT_TIKTOK_FEED_URL = "https://rss-bridge.sans-nuage.fr/?action=display&bridge=TikTokBridge&context=By+user&username=%40custrentoc5&format=Json"
DEFAULT_THUMBNAIL = "https://custrentocalcioa5.it/oldsite/wp-content/uploads/2026/01/1.-CUS-Trento-C5-scaled.png"


FEED_HEADERS = {
    "User-Agent": "CUS-Trento-C5-SocialFeedUpdater/1.0",
    "Accept": "application/feed+json, application/json, */*",
}

IMAGE_HEADERS_BY_PLATFORM = {
    "instagram": {
        "User-Agent": "Mozilla/5.0 (compatible; CUS-Trento-C5-SocialFeedUpdater/1.0)",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Referer": "https://www.instagram.com/",
    },
    "tiktok": {
        "User-Agent": "Mozilla/5.0 (compatible; CUS-Trento-C5-SocialFeedUpdater/1.0)",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Referer": "https://www.tiktok.com/",
    },
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
    value = html.unescape(str(value or ""))
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


def local_image_path_for(platform: str, post_url: str, image_url: str, content_type: str = "") -> Path:
    digest_source = post_url or image_url
    digest = hashlib.sha1(digest_source.encode("utf-8", errors="ignore")).hexdigest()[:16]
    safe_platform = re.sub(r"[^a-z0-9_-]+", "", platform.lower()) or "social"
    return Path("img/social") / f"{safe_platform}-{digest}{image_extension(image_url, content_type)}"


def to_site_path(path: Path) -> str:
    return "/" + path.as_posix().lstrip("/")


def download_image(
    platform: str,
    image_url: str,
    post_url: str,
    repo_root: Path,
    existing_local_image: str = "",
) -> tuple[str, str]:
    """
    Downloads a remote RSS image into img/social and returns:
    - public site path, for example /img/social/instagram-xxxx.jpg
    - original remote image URL

    If download fails, keeps the previous local image for the same post if available;
    otherwise falls back to DEFAULT_THUMBNAIL.
    """
    image_url = html.unescape(str(image_url or "")).strip()
    if not image_url or image_url == DEFAULT_THUMBNAIL:
        return existing_local_image or DEFAULT_THUMBNAIL, image_url

    if existing_local_image and existing_local_image.startswith("/img/social/"):
        existing_file = repo_root / existing_local_image.lstrip("/")
        if existing_file.exists() and existing_file.stat().st_size > 0:
            return existing_local_image, image_url

    headers = IMAGE_HEADERS_BY_PLATFORM.get(platform.lower(), IMAGE_HEADERS_BY_PLATFORM["instagram"])

    try:
        with requests.get(image_url, timeout=45, headers=headers, stream=True) as response:
            response.raise_for_status()
            content_type = response.headers.get("Content-Type", "")
            if content_type and not content_type.lower().startswith("image/"):
                raise ValueError(f"unexpected content type: {content_type}")

            relative_path = local_image_path_for(platform, post_url, image_url, content_type)
            output_path = repo_root / relative_path
            output_path.parent.mkdir(parents=True, exist_ok=True)

            max_bytes = 12 * 1024 * 1024
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
        print(f"WARN: image download failed for {platform} {post_url or image_url}: {exc}", flush=True)
        return existing_local_image or DEFAULT_THUMBNAIL, image_url


def extract_remote_image(item: dict) -> str:
    image = item.get("image") or item.get("banner_image") or ""
    if image:
        return html.unescape(str(image))

    attachments = item.get("attachments") or []
    for attachment in attachments:
        if not isinstance(attachment, dict):
            continue
        if attachment.get("image"):
            return html.unescape(str(attachment["image"]))
        if attachment.get("url") and str(attachment.get("mime_type", "")).startswith("image/"):
            return html.unescape(str(attachment["url"]))
        if attachment.get("url"):
            return html.unescape(str(attachment["url"]))

    return ""


def normalize_item(
    item: dict,
    index: int,
    platform: str,
    handle: str,
    repo_root: Path,
    existing_by_url: dict[str, dict],
) -> dict:
    platform_lower = platform.lower()
    platform_label = "Instagram" if platform_lower == "instagram" else "TikTok"
    post_url = html.unescape(str(item.get("url") or item.get("external_url") or "")).strip()
    remote_image = extract_remote_image(item)

    existing = existing_by_url.get(post_url, {}) if post_url else {}
    existing_local_image = str(existing.get("image") or existing.get("thumbnail") or "")
    if existing_local_image.startswith("http"):
        existing_local_image = ""

    local_image, original_image = download_image(
        platform=platform_lower,
        image_url=remote_image,
        post_url=post_url,
        repo_root=repo_root,
        existing_local_image=existing_local_image,
    )

    text = clean_text(
        item.get("content_text")
        or item.get("summary")
        or item.get("title")
        or f"Post {platform_label}"
    )

    title = clean_text(item.get("title") or text or f"Post {platform_label}")
    if len(title) > 120:
        title = title[:117].rstrip() + "..."

    published = str(item.get("date_published") or item.get("date_modified") or "")
    item_id = item.get("id") or hashlib.sha1((post_url or f"{platform}-{index}").encode()).hexdigest()[:12]

    return {
        "id": f"{platform_lower}-{item_id}",
        "platform": platform_label,
        "source": "rss.app",
        "username": handle,
        "handle": handle,
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


def platform_key(item: dict) -> str:
    return str(item.get("platform") or "").strip().lower()


def merge_social_posts(existing: list[dict], imported_by_platform: dict[str, list[dict]]) -> list[dict]:
    replaced_platforms = {k.lower() for k, v in imported_by_platform.items() if v}

    kept = [item for item in existing if platform_key(item) not in replaced_platforms]

    ordered_imports: list[dict] = []
    for platform in ("instagram", "tiktok"):
        ordered_imports.extend(imported_by_platform.get(platform, []))

    merged = ordered_imports + kept

    seen = set()
    unique = []
    for item in merged:
        key = item.get("url") or item.get("permalink") or item.get("id")
        if not key:
            continue
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)

    return unique


def read_platform_feed(
    platform: str,
    feed_url: str,
    limit: int,
    handle: str,
    repo_root: Path,
    existing_by_url: dict[str, dict],
) -> list[dict]:
    print(f"Reading {platform} JSON feed: {feed_url}")
    try:
        payload = fetch_rss_app_json(feed_url)
    except Exception as exc:
        print(f"WARN: failed to fetch {platform} RSS.app JSON feed: {exc}", flush=True)
        return []

    raw_items = payload.get("items") or []
    print(f"{platform} RSS.app items found: {len(raw_items)}")

    posts = []
    for index, item in enumerate(raw_items[:limit], start=1):
        normalized = normalize_item(item, index, platform, handle, repo_root, existing_by_url)
        if normalized.get("url"):
            posts.append(normalized)

    print(f"Usable {platform} posts: {len(posts)}")
    return posts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--instagram-feed-url", default=DEFAULT_INSTAGRAM_FEED_URL)
    parser.add_argument("--tiktok-feed-url", default=DEFAULT_TIKTOK_FEED_URL)
    parser.add_argument("--feed-url", default="", help="Backward-compatible alias for --instagram-feed-url")
    parser.add_argument("--feed", default="content/social-feed.json")
    parser.add_argument("--instagram-limit", type=int, default=4)
    parser.add_argument("--tiktok-limit", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0, help="Backward-compatible limit applied to Instagram only")
    parser.add_argument("--instagram-handle", default="@custrentoc5")
    parser.add_argument("--tiktok-handle", default="@custrentoc5")
    args = parser.parse_args()

    if args.feed_url:
        args.instagram_feed_url = args.feed_url
    if args.limit and args.limit > 0:
        args.instagram_limit = args.limit

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

    instagram_posts = read_platform_feed(
        platform="instagram",
        feed_url=args.instagram_feed_url,
        limit=args.instagram_limit,
        handle=args.instagram_handle,
        repo_root=repo_root,
        existing_by_url=existing_by_url,
    )

    tiktok_posts = read_platform_feed(
        platform="tiktok",
        feed_url=args.tiktok_feed_url,
        limit=args.tiktok_limit,
        handle=args.tiktok_handle,
        repo_root=repo_root,
        existing_by_url=existing_by_url,
    )

    if not instagram_posts and not tiktok_posts:
        print("WARN: no usable social posts found. Keeping existing feed unchanged.")
        return 0

    new_posts = merge_social_posts(
        old_posts,
        {
            "instagram": instagram_posts,
            "tiktok": tiktok_posts,
        },
    )

    if output_as_list:
        new_payload = new_posts
    else:
        new_payload = {
            **(existing_payload if isinstance(existing_payload, dict) else {}),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "instagramFeedUrl": args.instagram_feed_url,
            "tiktokFeedUrl": args.tiktok_feed_url,
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
    print(f"Imported TikTok posts: {len(tiktok_posts)}")
    print(f"Total social feed posts now: {len(new_posts)}")
    print("Images saved under img/social when available.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
