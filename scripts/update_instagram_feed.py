#!/usr/bin/env python3
from **future** import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

DEFAULT_FEED_URL = "https://rss.app/feeds/v1.1/ZARGBanc4ELDomJR.json"

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

```
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
    "platform": "instagram",
    "source": "instagram",
    "username": "custrentoc5",
    "handle": "@custrentoc5",
    "title": title,
    "text": text,
    "caption": text,
    "url": post_url,
    "permalink": post_url,
    "image": image,
    "thumbnail": image,
    "date": published[:10] if published else "",
    "publishedAt": published,
    "updatedAt": datetime.now(timezone.utc).isoformat(),
    "importedFrom": "rss.app",
}
```

def merge_instagram_items(existing: list[dict], instagram_items: list[dict]) -> list[dict]:
non_instagram = [
item for item in existing
if str(item.get("platform") or item.get("source") or "").lower() != "instagram"
]

```
merged = instagram_items + non_instagram

seen = set()
unique = []
for item in merged:
    key = item.get("url") or item.get("permalink") or item.get("id")
    if not key or key in seen:
        continue
    seen.add(key)
    unique.append(item)

return unique
```

def main() -> int:
parser = argparse.ArgumentParser()
parser.add_argument("--feed-url", default=DEFAULT_FEED_URL)
parser.add_argument("--feed", default="content/social-feed.json")
parser.add_argument("--limit", type=int, default=4)
args = parser.parse_args()

```
feed_path = Path(args.feed)
existing_payload = load_json(feed_path, {"items": []})

if isinstance(existing_payload, list):
    existing_items = existing_payload
    output_as_list = True
else:
    existing_items = existing_payload.get("items", [])
    output_as_list = False

print(f"Existing social feed items: {len(existing_items)}")
print(f"Reading Instagram JSON feed: {args.feed_url}")

try:
    payload = fetch_rss_app_json(args.feed_url)
except Exception as exc:
    print(f"WARN: failed to fetch RSS.app JSON feed: {exc}", flush=True)
    print("Keeping existing social-feed.json unchanged.")
    return 0

raw_items = payload.get("items") or []
print(f"RSS.app items found: {len(raw_items)}")

instagram_items = []
for index, item in enumerate(raw_items[: args.limit], start=1):
    normalized = normalize_item(item, index)
    if normalized.get("url"):
        instagram_items.append(normalized)

if not instagram_items:
    print("WARN: no usable Instagram posts found. Keeping existing feed unchanged.")
    return 0

new_items = merge_instagram_items(existing_items, instagram_items)

if output_as_list:
    new_payload = new_items
else:
    new_payload = {
        **existing_payload,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "instagramFeedUrl": args.feed_url,
        "items": new_items,
    }

before = json.dumps(existing_payload, ensure_ascii=False, sort_keys=True)
after = json.dumps(new_payload, ensure_ascii=False, sort_keys=True)

if before == after:
    print("No social feed changes.")
    return 0

save_json(feed_path, new_payload)

print(f"Imported Instagram posts: {len(instagram_items)}")
print(f"Total social feed items now: {len(new_items)}")
return 0
```

if **name** == "**main**":
raise SystemExit(main())
