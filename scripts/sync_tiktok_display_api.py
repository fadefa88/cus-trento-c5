#!/usr/bin/env python3
"""Official TikTok Display API -> CUS Trento social-feed.json.

Credentials are encrypted before they are saved, with a Fernet key kept only in
GitHub Actions secrets. Never place API tokens or Client Secret in the feed.
"""
from __future__ import annotations

import argparse
import getpass
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

import requests
from cryptography.fernet import Fernet
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FEED = ROOT / "content/social-feed.json"
TOKEN_FILE = ROOT / ".github/tiktok-display-credentials.enc"
STATE_FILE = ROOT / ".tiktok-auth-state"
BASE = "https://open.tiktokapis.com"
SCOPES = "user.info.basic,video.list"
FIELDS = "id,create_time,cover_image_url,share_url,video_description,title"


def required(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing {name}; see docs/tiktok-display-api.md")
    return value


def crypto():
    return Fernet(required("TIKTOK_FERNET_KEY").encode("ascii"))


def load_credentials():
    if not TOKEN_FILE.is_file():
        raise RuntimeError("TikTok not authorized yet. Complete the local activate step.")
    return json.loads(crypto().decrypt(TOKEN_FILE.read_bytes()).decode("utf-8"))


def save_credentials(payload):
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_bytes(crypto().encrypt(json.dumps(payload).encode("utf-8")) + b"\n")
    TOKEN_FILE.chmod(0o600)


def auth_url():
    client_key = required("TIKTOK_CLIENT_KEY")
    redirect_uri = required("TIKTOK_REDIRECT_URI")
    if not redirect_uri.startswith("https://"):
        raise RuntimeError("TikTok web redirect URI must use HTTPS")
    state = secrets.token_urlsafe(32)
    STATE_FILE.write_text(state, encoding="utf-8")
    STATE_FILE.chmod(0o600)
    query = urlencode({
        "client_key": client_key,
        "response_type": "code",
        "scope": SCOPES,
        "redirect_uri": redirect_uri,
        "state": state,
    })
    print("Authorize the CUS Trento account with this URL:\n")
    print(f"https://www.tiktok.com/v2/auth/authorize/?{query}")
    print("\nThen run 'activate' immediately (authorization code expires quickly).")


def token_request(form):
    response = requests.post(
        f"{BASE}/v2/oauth/token/",
        data={"client_key": required("TIKTOK_CLIENT_KEY"),
              "client_secret": required("TIKTOK_CLIENT_SECRET"), **form},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    if not payload.get("access_token") or not payload.get("refresh_token"):
        error = payload.get("error_description") or payload.get("error") or "missing credentials"
        raise RuntimeError(f"TikTok token request unsuccessful: {error}")
    if "video.list" not in str(payload.get("scope") or "").split(","):
        raise RuntimeError("TikTok authorization did not grant video.list permission")
    return payload


def package_token(payload, previous=None):
    now = int(time.time())
    result = dict(previous or {})
    result.update({
        "access_token": payload["access_token"],
        "refresh_token": payload["refresh_token"],
        "open_id": payload.get("open_id") or result.get("open_id", ""),
        "scope": payload["scope"],
        "expires_at": now + int(payload.get("expires_in", 86400)),
        "refresh_expires_at": now + int(payload.get("refresh_expires_in", 31536000)),
    })
    return result


def activate():
    if not STATE_FILE.is_file():
        raise RuntimeError("Run authorize first, on the same computer")
    expected_state = STATE_FILE.read_text(encoding="utf-8").strip()
    print("Paste the FULL redirect URL from the browser; it will not be printed or committed.")
    callback = getpass.getpass("Redirect URL: ")
    parsed = urlparse(callback)
    configured = urlparse(required("TIKTOK_REDIRECT_URI"))
    if (parsed.scheme, parsed.netloc, parsed.path) != (configured.scheme, configured.netloc, configured.path):
        raise RuntimeError("Redirect URL does not match configured TikTok callback")
    query = parse_qs(parsed.query)
    returned_state = (query.get("state") or [""])[0]
    if not hmac.compare_digest(expected_state, returned_state):
        raise RuntimeError("OAuth state mismatch; authorization rejected")
    code = (query.get("code") or [""])[0]
    if not code:
        raise RuntimeError(f"TikTok authorization returned no code: {query.get('error', ['unknown error'])[0]}")
    token = token_request({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": required("TIKTOK_REDIRECT_URI"),
    })
    save_credentials(package_token(token))
    STATE_FILE.unlink(missing_ok=True)
    print(f"Token encrypted in {TOKEN_FILE.relative_to(ROOT)}. Commit ONLY this encrypted file.")


def authenticated_token():
    credentials = load_credentials()
    if int(credentials.get("expires_at", 0)) - int(time.time()) > 1800:
        return credentials["access_token"]
    if int(credentials.get("refresh_expires_at", 0)) < int(time.time()):
        raise RuntimeError("TikTok authorization expired; reauthorize the CUS Trento account")
    updated = token_request({
        "grant_type": "refresh_token",
        "refresh_token": credentials["refresh_token"],
    })
    # Persist rotated refresh token before any subsequent video API request.
    save_credentials(package_token(updated, credentials))
    return updated["access_token"]


def fetch_latest(access_token, limit):
    result = requests.post(
        f"{BASE}/v2/video/list/",
        params={"fields": FIELDS},
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        json={"max_count": min(20, max(limit, 1))},
        timeout=40,
    )
    result.raise_for_status()
    payload = result.json()
    error = payload.get("error") or {}
    if error.get("code") not in ("ok", 0, None):
        raise RuntimeError(f"TikTok video.list rejected request: {error.get('code')} {error.get('message', '')}")
    return (payload.get("data") or {}).get("videos") or []


def is_valid_local(src):
    if not isinstance(src, str) or not re.fullmatch(r"/img/social/tiktok-[0-9a-f]{16}\.jpg", src):
        return False
    file = ROOT / src.lstrip("/")
    if not file.is_file():
        return False
    try:
        with Image.open(file) as img:
            return img.width >= 200 and img.height >= 200
    except (OSError, ValueError):
        return False


def cover_for(video_url, cover_url, prior):
    local = str(prior.get("image") or prior.get("thumbnail") or "")
    if is_valid_local(local):
        return local
    if not cover_url.startswith("https://") or "avt-" in cover_url or "cropcenter:100:100" in cover_url:
        return ""
    digest = hashlib.sha1(video_url.encode("utf-8")).hexdigest()[:16]
    relative = f"/img/social/tiktok-{digest}.jpg"
    destination = ROOT / relative.lstrip("/")
    try:
        res = requests.get(
            cover_url,
            headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.tiktok.com/"},
            timeout=35,
        )
        res.raise_for_status()
        if len(res.content) > 12 * 1024 * 1024 or len(res.content) < 100:
            raise ValueError("invalid image size")
        with Image.open(io.BytesIO(res.content)) as image:
            image.load()
            if min(image.width, image.height) < 200:
                raise ValueError("TikTok returned a profile/avatar image")
            destination.parent.mkdir(parents=True, exist_ok=True)
            image.convert("RGB").save(destination, format="JPEG", quality=88, optimize=True)
        return relative
    except (requests.RequestException, OSError, ValueError) as exc:
        print(f"WARN: TikTok cover for video {video_url.split('/')[-1]} unavailable: {exc}", file=sys.stderr)
        return ""


def normalize_video(video, existing_by_url):
    video_id = str(video.get("id") or "")
    if not re.fullmatch(r"\d{10,25}", video_id):
        return None
    canonical = f"https://www.tiktok.com/@custrentoc5/video/{video_id}"
    prior = existing_by_url.get(video_id, {})
    image = cover_for(canonical, str(video.get("cover_image_url") or ""), prior)
    if not image:
        print(f"WARN: Skipping TikTok video {video_id} without verified cover", file=sys.stderr)
        return None
    description = str(video.get("video_description") or video.get("title") or "").strip()
    if not description or description.startswith("https://"):
        description = str(prior.get("caption") or "").strip()
    if not description or description.startswith("https://"):
        description = "Video TikTok CUS Trento C5"
    timestamp = int(video.get("create_time") or 0)
    published = datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat() if timestamp > 0 else ""
    return {
        "id": "tiktok-" + hashlib.sha1(canonical.encode()).hexdigest()[:16],
        "platform": "TikTok",
        "source": "tiktok-display-api",
        "importedFrom": "tiktok-display-api",
        "username": "@custrentoc5",
        "handle": "@custrentoc5",
        "title": description[:120],
        "caption": description,
        "text": description,
        "url": canonical,
        "permalink": canonical,
        "image": image,
        "thumbnail": image,
        "date": published[:10] if published else "",
        "publishedAt": published,
        "placeholder": False,
        "hidden": False,
    }


def sync(limit):
    token = authenticated_token()
    videos = fetch_latest(token, limit)
    if not videos:
        raise RuntimeError("TikTok Display API returned no videos; preserving the current feed")
    original = json.loads(FEED.read_text(encoding="utf-8"))
    existing = original.get("posts") or []
    previous = {
        str(item.get("url") or "").split("/video/")[-1].split("?")[0]: item
        for item in existing
        if str(item.get("platform") or "").lower() == "tiktok"
    }
    imported = []
    for video in videos[:limit]:
        item = normalize_video(video, previous)
        if item:
            imported.append(item)
    if not imported:
        raise RuntimeError("No TikTok covers could be verified; previous feed preserved")
    other_posts = [post for post in existing if str(post.get("platform") or "").lower() != "tiktok"]
    imported_ids = {item["url"].split("/video/")[-1] for item in imported}
    older = [
        item for video_id, item in previous.items()
        if video_id not in imported_ids and is_valid_local(str(item.get("image") or ""))
    ]
    new_posts = other_posts + imported + older[:max(0, limit - len(imported))]
    payload = dict(original)
    payload["posts"] = new_posts
    payload.setdefault("sourceHits", {})["tiktokDisplayAPI"] = len(imported)
    before = dict(original)
    before.pop("updatedAt", None)
    comparable = dict(payload)
    comparable.pop("updatedAt", None)
    if before != comparable:
        payload["updatedAt"] = datetime.now(timezone.utc).isoformat()
        FEED.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Updated official TikTok feed with {len(imported)} verified latest videos.")
    else:
        print("TikTok Display API feed unchanged.")


def main():
    parser = argparse.ArgumentParser(description="Official TikTok CUS Trento Display API integration")
    parser.add_argument("action", choices=["authorize", "activate", "sync"])
    parser.add_argument("--limit", type=int, default=12)
    args = parser.parse_args()
    if args.action == "authorize":
        auth_url()
    elif args.action == "activate":
        activate()
    else:
        sync(max(1, min(20, args.limit)))


if __name__ == "__main__":
    main()
