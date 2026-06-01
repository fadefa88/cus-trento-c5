#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse

import requests
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

DEFAULT_ELFSIGHT_APP_ID = "017a8b39-9a1b-46d1-b742-cb533321bea1"
DEFAULT_EMBEDSOCIAL_REF = "9abb7ef43c2b80e9cc04e6d7b00fb4d4ebd3e83b"
DEFAULT_THUMBNAIL = "https://custrentocalcioa5.it/oldsite/wp-content/uploads/2026/01/1.-CUS-Trento-C5-scaled.png"
DEFAULT_HANDLE = "@custrentoc5"
DEFAULT_TIKTOK_HANDLE = "@custrentoc5"
DEFAULT_TIKTOK_FEED_URL = "https://rss-bridge.sans-nuage.fr/?action=display&bridge=TikTokBridge&context=By+user&username=%40custrentoc5&format=Json"

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)

IMAGE_HEADERS = {
    "User-Agent": BROWSER_UA,
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Referer": "https://www.instagram.com/",
}

INSTAGRAM_URL_RE = re.compile(r"https?:\\/\\/(?:www\\.)?instagram\\.com\\/(?:p|reel|tv)\\/[A-Za-z0-9_-]+[^\\s\"'<>)]*", re.I)
IMAGE_URL_RE = re.compile(r"https?:\\/\\/[^\\s\"'<>)]*?(?:\\.jpg|\\.jpeg|\\.png|\\.webp)(?:\\?[^\\s\"'<>)]*)?", re.I)

EXTRACT_POSTS_JS = r"""
(() => {
  const clean = (value) => String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\n]+/g, " ")
    .trim();

  const absolutize = (url) => {
    try { return new URL(url, location.href).href; } catch (_) { return ""; }
  };

  const decodeLoose = (value) => {
    const raw = String(value || "");
    const out = new Set([raw]);
    try { out.add(decodeURIComponent(raw)); } catch (_) {}
    try { out.add(JSON.parse('"' + raw.replace(/"/g, '\\"') + '"')); } catch (_) {}
    return [...out].join(" ");
  };

  const instagramUrlFromText = (value) => {
    const text = decodeLoose(value);
    const match = text.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[A-Za-z0-9_-]+[^\s"'<>)]*/i);
    if (!match) return "";
    return match[0];
  };

  const canonicalInstagramUrl = (href) => {
    const url = instagramUrlFromText(absolutize(href) || href);
    if (!url) return "";
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length >= 2 && ["p", "reel", "tv"].includes(parts[0].toLowerCase())) {
        return `https://www.instagram.com/${parts[0]}/${parts[1]}`;
      }
      return `https://www.instagram.com${parsed.pathname.replace(/\/$/, "")}`;
    } catch (_) {
      return url;
    }
  };

  const isVisible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 8 && rect.height > 8 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0;
  };

  const walkDeep = (root) => {
    const out = [];
    const visit = (node) => {
      if (!node) return;
      if (node.nodeType === 1) {
        out.push(node);
        if (node.shadowRoot) visit(node.shadowRoot);
      }
      const children = node.children || [];
      for (const child of children) visit(child);
    };
    visit(root);
    return out;
  };

  const allNodes = walkDeep(document.documentElement || document.body || document);

  const scoreImage = (img) => {
    const src = img.currentSrc || img.src || img.getAttribute("data-src") || img.getAttribute("data-original") || img.getAttribute("data-lazy-src") || img.getAttribute("srcset") || "";
    const lower = src.toLowerCase();
    if (!src) return -1;
    if (lower.startsWith("data:image/svg")) return -1;
    if (lower.includes("logo") || lower.includes("branding") || lower.includes("embed-social") || lower.includes("embedsocial-logo") || lower.includes("elfsight")) return -1;
    const rect = img.getBoundingClientRect();
    const w = img.naturalWidth || rect.width || 0;
    const h = img.naturalHeight || rect.height || 0;
    if (w < 60 || h < 60) return -1;
    const area = w * h;
    const ratio = w && h ? Math.max(w / h, h / w) : 1;
    return area - (ratio > 3 ? area * 0.6 : 0);
  };

  const bestSrcFromSrcset = (srcset) => {
    if (!srcset) return "";
    const entries = String(srcset).split(",").map(x => x.trim()).filter(Boolean);
    const last = entries[entries.length - 1] || "";
    return last.split(/\s+/)[0] || "";
  };

  const getBackgroundImage = (root) => {
    const nodes = walkDeep(root).filter(isVisible);
    let best = "";
    let bestArea = 0;
    for (const node of nodes) {
      const style = window.getComputedStyle(node);
      const bg = style.backgroundImage || "";
      const match = bg.match(/url\(["']?([^"')]+)["']?\)/i);
      if (!match) continue;
      const src = absolutize(match[1]);
      const lower = src.toLowerCase();
      if (lower.includes("logo") || lower.includes("branding") || lower.includes("elfsight")) continue;
      const rect = node.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        best = src;
      }
    }
    return best;
  };

  const bestImage = (root) => {
    const imgs = walkDeep(root).filter(n => n.tagName && n.tagName.toLowerCase() === "img" && isVisible(n));
    const ranked = imgs.map(img => ({ img, score: scoreImage(img) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
    if (ranked.length) {
      const img = ranked[0].img;
      const raw = img.currentSrc || img.src || img.getAttribute("data-src") || img.getAttribute("data-original") || img.getAttribute("data-lazy-src") || bestSrcFromSrcset(img.getAttribute("srcset")) || "";
      return absolutize(raw);
    }
    return getBackgroundImage(root);
  };

  const trimCaption = (text) => {
    let t = clean(text);
    const removals = [
      /instagram widget/ig,
      /powered by embedSocial/ig,
      /powered by/ig,
      /EmbedSocial/ig,
      /Elfsight/ig,
      /follow on instagram/ig,
      /view on instagram/ig,
      /open in instagram/ig,
      /load more/ig,
      /read more/ig,
      /show more/ig,
      /@custrentoc5/ig,
      /instagram/ig
    ];
    for (const re of removals) t = t.replace(re, " ");
    t = clean(t);
    if (t.length > 500) t = t.slice(0, 497).trim() + "...";
    return t;
  };

  const chooseRoot = (node) => {
    let current = node;
    let best = node;
    for (let depth = 0; depth < 10 && current && current.parentElement; depth += 1) {
      current = current.parentElement;
      const rect = current.getBoundingClientRect();
      const text = clean(current.innerText || current.textContent || "");
      const imageCount = walkDeep(current).filter(n => n.tagName && n.tagName.toLowerCase() === "img").length;
      const igCount = walkDeep(current).filter(n => {
        if (!n.getAttributeNames) return false;
        return n.getAttributeNames().some(a => canonicalInstagramUrl(n.getAttribute(a) || ""));
      }).length;
      if (rect.width >= 100 && rect.height >= 100 && (imageCount > 0 || text.length > 10) && igCount <= 5) {
        best = current;
      }
      if (igCount > 5 && depth > 1) break;
    }
    return best;
  };

  const candidates = [];
  for (const node of allNodes) {
    if (!node.getAttributeNames) continue;
    const attrs = node.getAttributeNames();
    for (const attr of attrs) {
      const value = node.getAttribute(attr) || "";
      const url = canonicalInstagramUrl(value);
      if (url) candidates.push({node, url});
    }
    if (node.tagName && node.tagName.toLowerCase() === "a") {
      const url = canonicalInstagramUrl(node.href || "");
      if (url) candidates.push({node, url});
    }
  }

  const seen = new Set();
  const items = [];
  for (const {node, url} of candidates) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const root = chooseRoot(node);
    const time = walkDeep(root).find(n => n.tagName && n.tagName.toLowerCase() === "time" && n.getAttribute("datetime"));
    const caption = trimCaption(root.innerText || root.textContent || node.getAttribute("aria-label") || node.title || "");
    items.push({
      url,
      caption,
      title: caption,
      image: bestImage(root),
      date: time ? time.getAttribute("datetime") : ""
    });
  }

  return items;
})()
"""


def clean_text(value: Any) -> str:
    value = html.unescape(str(value or ""))
    value = re.sub(r"\\u[0-9a-fA-F]{4}", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def normalize_instagram_url(url: str) -> str:
    url = html.unescape(str(url or "")).strip().rstrip("/")
    if not url:
        return ""
    try:
        parsed = urlparse(url)
    except Exception:
        return url
    if "instagram.com" not in parsed.netloc.lower():
        return ""
    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) >= 2 and parts[0].lower() in {"p", "reel", "tv"}:
        path = f"/{parts[0].lower()}/{parts[1]}"
        return urlunparse(("https", "www.instagram.com", path, "", "", ""))
    return ""


def load_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def save_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_widget_html(source: str, elfsight_app_id: str, embedsocial_ref: str) -> str:
    if source == "elfsight":
        body = f'''
<script src="https://elfsightcdn.com/platform.js" async></script>
<div class="elfsight-app-{html.escape(elfsight_app_id)}" data-elfsight-app-lazy></div>
'''
    elif source == "embedsocial":
        body = f'''
<div class="embedsocial-hashtag" data-ref="{html.escape(embedsocial_ref)}">
  <a class="feed-powered-by-es feed-powered-by-es-slider-img es-widget-branding" href="https://embedsocial.com/instagram-widget/" target="_blank" title="Instagram widget">
    <img src="https://embedsocial.com/cdn/icon/embedsocial-logo.webp" alt="EmbedSocial">
    <div class="es-widget-branding-text">Instagram widget</div>
  </a>
</div>
<script>
(function(d, s, id) {{
  var js;
  if (d.getElementById(id)) {{ return; }}
  js = d.createElement(s);
  js.id = id;
  js.src = "https://embedsocial.com/cdn/ht.js";
  d.getElementsByTagName("head")[0].appendChild(js);
}}(document, "script", "EmbedSocialHashtagScript"));
</script>
'''
    else:
        raise ValueError(f"unsupported source: {source}")

    return f'''<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Instagram source probe - {html.escape(source)}</title>
  <style>
    body {{ margin:0; padding:24px; font-family:Arial,sans-serif; background:#fff; }}
    .probe {{ max-width:1200px; margin:0 auto; }}
  </style>
</head>
<body>
  <div class="probe" data-source="{html.escape(source)}">
    {body}
  </div>
</body>
</html>'''


def extract_urls(text: str) -> list[str]:
    if not text:
        return []
    candidates = set()
    blobs = {text}
    try:
        blobs.add(html.unescape(text))
    except Exception:
        pass
    try:
        from urllib.parse import unquote
        blobs.add(unquote(text))
    except Exception:
        pass
    for blob in blobs:
        for match in INSTAGRAM_URL_RE.findall(blob):
            url = normalize_instagram_url(match)
            if url:
                candidates.add(url)
    return list(candidates)


def guess_image_from_text(text: str) -> str:
    for match in IMAGE_URL_RE.findall(text or ""):
        lower = match.lower()
        if any(blocked in lower for blocked in ("logo", "branding", "elfsight", "embedsocial-logo", "icon")):
            continue
        return html.unescape(match)
    return ""


def walk_json(obj: Any) -> list[dict]:
    items: list[dict] = []

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            blob = json.dumps(value, ensure_ascii=False)
            urls = extract_urls(blob)
            if urls:
                caption = ""
                image = ""
                date = ""
                for key in ("caption", "text", "description", "message", "title", "name"):
                    if isinstance(value.get(key), str) and len(value.get(key, "")) > len(caption):
                        caption = value[key]
                for key in ("image", "thumbnail", "thumbnail_url", "image_url", "media_url", "display_url", "src", "url"):
                    v = value.get(key)
                    if isinstance(v, str) and re.search(r"\.(jpg|jpeg|png|webp)(\?|$)", v, re.I):
                        image = v
                        break
                if not image:
                    image = guess_image_from_text(blob)
                for key in ("date", "datetime", "timestamp", "created_time", "published_at", "createdAt"):
                    if isinstance(value.get(key), str):
                        date = value[key]
                        break
                for url in urls:
                    items.append({"url": url, "caption": clean_text(caption), "title": clean_text(caption), "image": image, "date": date})
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
        elif isinstance(value, str):
            urls = extract_urls(value)
            if urls:
                image = guess_image_from_text(value)
                for url in urls:
                    items.append({"url": url, "caption": "", "title": "", "image": image, "date": ""})

    visit(obj)
    return items


def parse_response_payloads(payloads: list[str]) -> list[dict]:
    parsed: list[dict] = []
    for payload in payloads:
        if not payload:
            continue
        try:
            parsed.extend(walk_json(json.loads(payload)))
            continue
        except Exception:
            pass
        urls = extract_urls(payload)
        if urls:
            image = guess_image_from_text(payload)
            for url in urls:
                parsed.append({"url": url, "caption": "", "title": "", "image": image, "date": ""})
    return parsed


def extract_posts_with_playwright(source: str, elfsight_app_id: str, embedsocial_ref: str, wait_ms: int) -> list[dict]:
    collected: list[dict] = []
    response_payloads: list[str] = []
    html_doc = build_widget_html(source, elfsight_app_id, embedsocial_ref)

    with sync_playwright() as p:
        launch_kwargs: dict[str, Any] = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
        executable_candidates = [
            getattr(p.chromium, "executable_path", ""),
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/google-chrome",
        ]
        for executable_path in executable_candidates:
            if executable_path and Path(executable_path).exists():
                launch_kwargs["executable_path"] = executable_path
                break
        browser = p.chromium.launch(**launch_kwargs)
        context = browser.new_context(
            user_agent=BROWSER_UA,
            viewport={"width": 1440, "height": 2200},
            locale="it-IT",
            ignore_https_errors=True,
        )
        page = context.new_page()

        def on_response(response) -> None:
            try:
                url = response.url.lower()
                ctype = (response.headers.get("content-type") or "").lower()
                if not any(token in url for token in ("elfsight", "embedsocial", "instagram")):
                    return
                if not any(token in ctype for token in ("json", "text", "javascript", "html")):
                    return
                body = response.text()
                if body and len(body) <= 6_000_000:
                    response_payloads.append(body)
            except Exception:
                return

        page.on("response", on_response)

        print(f"Rendering {source} widget as data source")
        page.set_content(html_doc, wait_until="domcontentloaded", timeout=90000)
        try:
            page.wait_for_load_state("networkidle", timeout=45000)
        except PlaywrightTimeoutError:
            pass
        if wait_ms > 0:
            page.wait_for_timeout(wait_ms)

        # Trigger lazy-load and carousel/gallery rendering.
        for _ in range(3):
            try:
                page.mouse.wheel(0, 1400)
                page.wait_for_timeout(1200)
            except Exception:
                break

        for frame in page.frames:
            try:
                items = frame.evaluate(EXTRACT_POSTS_JS)
                if isinstance(items, list):
                    for item in items:
                        if isinstance(item, dict):
                            item["_source"] = source
                    collected.extend(items)
            except Exception:
                continue

        context.close()
        browser.close()

    response_items = parse_response_payloads(response_payloads)
    for item in response_items:
        item["_source"] = source
    collected.extend(response_items)
    return collected


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


def local_image_path_for(post_url: str, image_url: str, content_type: str = "", prefix: str = "instagram") -> Path:
    digest_source = post_url or image_url
    digest = hashlib.sha1(digest_source.encode("utf-8", errors="ignore")).hexdigest()[:16]
    safe_prefix = re.sub(r"[^a-z0-9_-]+", "-", str(prefix or "social").lower()).strip("-") or "social"
    return Path("img/social") / f"{safe_prefix}-{digest}{image_extension(image_url, content_type)}"


def to_site_path(path: Path) -> str:
    return "/" + path.as_posix().lstrip("/")


def download_image(image_url: str, post_url: str, repo_root: Path, existing_local_image: str = "", prefix: str = "instagram") -> tuple[str, str]:
    image_url = html.unescape(str(image_url or "")).strip()

    if existing_local_image and existing_local_image.startswith("/img/social/"):
        existing_file = repo_root / existing_local_image.lstrip("/")
        if existing_file.exists() and existing_file.stat().st_size > 0:
            return existing_local_image, image_url

    if not image_url or image_url.startswith("data:") or image_url.startswith("blob:"):
        return existing_local_image or DEFAULT_THUMBNAIL, image_url

    try:
        with requests.get(image_url, timeout=45, headers=IMAGE_HEADERS, stream=True, allow_redirects=True) as response:
            response.raise_for_status()
            content_type = response.headers.get("Content-Type", "")
            if content_type and not content_type.lower().startswith("image/"):
                raise ValueError(f"unexpected content type: {content_type}")

            relative_path = local_image_path_for(post_url, image_url, content_type, prefix=prefix)
            output_path = repo_root / relative_path
            output_path.parent.mkdir(parents=True, exist_ok=True)

            max_bytes = 14 * 1024 * 1024
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


def existing_posts(payload: Any) -> tuple[list[dict], bool]:
    if isinstance(payload, list):
        return payload, True
    if isinstance(payload, dict):
        if isinstance(payload.get("posts"), list):
            return payload["posts"], False
        if isinstance(payload.get("items"), list):
            return payload["items"], False
    return [], False


def quality_score(item: dict) -> int:
    score = 0
    if normalize_instagram_url(str(item.get("url") or "")):
        score += 100
    caption = clean_text(item.get("caption") or item.get("title") or "")
    image = str(item.get("image") or "")
    date = str(item.get("date") or "")
    score += min(len(caption), 300)
    if image and not image.startswith("data:"):
        score += 80
    if date:
        score += 20
    return score


def normalize_item(raw: dict, repo_root: Path, existing_by_url: dict[str, dict], handle: str, source: str) -> dict | None:
    post_url = normalize_instagram_url(str(raw.get("url") or ""))
    if not post_url:
        return None

    existing = existing_by_url.get(post_url, {})
    existing_local_image = str(existing.get("image") or existing.get("thumbnail") or "")
    if existing_local_image.startswith("http"):
        existing_local_image = ""

    local_image, remote_image = download_image(
        image_url=str(raw.get("image") or ""),
        post_url=post_url,
        repo_root=repo_root,
        existing_local_image=existing_local_image,
        prefix="instagram",
    )

    caption = clean_text(raw.get("caption") or raw.get("title") or existing.get("caption") or existing.get("text") or "Post Instagram CUS Trento C5")
    if not caption:
        caption = "Post Instagram CUS Trento C5"
    title = caption if len(caption) <= 120 else caption[:117].rstrip() + "..."

    published = clean_text(raw.get("date") or existing.get("publishedAt") or existing.get("date") or "")
    date = published[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", published) else str(existing.get("date") or "")

    item_id = hashlib.sha1(post_url.encode("utf-8", errors="ignore")).hexdigest()[:16]

    return {
        "id": f"instagram-{item_id}",
        "platform": "Instagram",
        "source": source,
        "username": handle,
        "handle": handle,
        "title": title,
        "text": caption,
        "caption": caption,
        "url": post_url,
        "permalink": post_url,
        "image": local_image,
        "thumbnail": local_image,
        "remoteImage": remote_image,
        "date": date,
        "publishedAt": published,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "importedFrom": source,
        "placeholder": False,
    }



def normalize_tiktok_url(url: str) -> str:
    url = html.unescape(str(url or "")).strip().rstrip("/")
    if not url:
        return ""
    match = TIKTOK_URL_RE.search(url)
    if match:
        url = match.group(0)
    try:
        parsed = urlparse(url)
    except Exception:
        return ""
    if "tiktok.com" not in parsed.netloc.lower():
        return ""
    path = parsed.path.rstrip("/")
    if "/video/" not in path:
        return ""
    return urlunparse(("https", "www.tiktok.com", path, "", "", ""))


def parse_date(value: Any) -> tuple[str, str]:
    raw = clean_text(value)
    if not raw:
        return "", ""
    if re.match(r"^\d{4}-\d{2}-\d{2}", raw):
        return raw[:10], raw
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        iso = dt.astimezone(timezone.utc).isoformat()
        return iso[:10], iso
    except Exception:
        return "", raw


def image_from_html_fragment(value: str) -> str:
    text = html.unescape(str(value or ""))
    # Prefer explicit img src values, then any image-looking URL.
    for pattern in (
        r'<img[^>]+src=["\\\']([^"\\\']+)["\\\']',
        r'<meta[^>]+content=["\\\']([^"\\\']+)["\\\'][^>]+property=["\\\']og:image["\\\']',
        r'<meta[^>]+property=["\\\']og:image["\\\'][^>]+content=["\\\']([^"\\\']+)["\\\']',
    ):
        match = re.search(pattern, text, re.I)
        if match:
            return html.unescape(match.group(1))
    return guess_image_from_text(text)


def first_string(*values: Any) -> str:
    for value in values:
        if isinstance(value, str) and clean_text(value):
            return clean_text(value)
    return ""


def tiktok_image_from_item(item: dict) -> str:
    # RSS-Bridge/JsonFeed structures vary. Check common direct fields first.
    direct_keys = (
        "image", "thumbnail", "thumbnail_url", "image_url", "media_url", "banner_image",
        "poster", "cover", "display_url", "icon"
    )
    for key in direct_keys:
        value = item.get(key)
        if isinstance(value, str) and value.startswith("http"):
            return html.unescape(value)

    attachments = item.get("attachments")
    if isinstance(attachments, list):
        for attachment in attachments:
            if not isinstance(attachment, dict):
                continue
            for key in ("url", "image", "thumbnail", "poster"):
                value = attachment.get(key)
                if isinstance(value, str) and value.startswith("http"):
                    return html.unescape(value)

    for key in ("content_html", "content_text", "summary", "description", "content"):
        value = item.get(key)
        if isinstance(value, str):
            image = image_from_html_fragment(value)
            if image:
                return image
    return ""


def normalize_tiktok_item(raw: dict, repo_root: Path, existing_by_url: dict[str, dict], handle: str) -> dict | None:
    post_url = normalize_tiktok_url(str(raw.get("url") or raw.get("external_url") or raw.get("id") or ""))
    if not post_url:
        return None

    existing = existing_by_url.get(post_url, {})
    existing_local_image = str(existing.get("image") or existing.get("thumbnail") or "")
    if existing_local_image.startswith("http"):
        existing_local_image = ""

    caption = first_string(
        raw.get("title"),
        raw.get("caption"),
        raw.get("content_text"),
        raw.get("summary"),
        raw.get("description"),
        existing.get("caption"),
        existing.get("text"),
    )
    if not caption:
        caption = "Video TikTok CUS Trento C5"
    # Remove crude HTML tags if RSS-Bridge puts content_html in title/description.
    caption = clean_text(re.sub(r"<[^>]+>", " ", caption))
    title = caption if len(caption) <= 120 else caption[:117].rstrip() + "..."

    date, published = parse_date(
        raw.get("date_published")
        or raw.get("date_modified")
        or raw.get("date")
        or raw.get("published")
        or raw.get("pubDate")
        or existing.get("publishedAt")
        or existing.get("date")
    )

    image_url = tiktok_image_from_item(raw)
    local_image, remote_image = download_image(
        image_url=image_url,
        post_url=post_url,
        repo_root=repo_root,
        existing_local_image=existing_local_image,
        prefix="tiktok",
    )

    item_id = hashlib.sha1(post_url.encode("utf-8", errors="ignore")).hexdigest()[:16]
    return {
        "id": f"tiktok-{item_id}",
        "platform": "TikTok",
        "source": "rss-bridge",
        "username": handle,
        "handle": handle,
        "title": title,
        "text": caption,
        "caption": caption,
        "url": post_url,
        "permalink": post_url,
        "image": local_image,
        "thumbnail": local_image,
        "remoteImage": remote_image,
        "date": date,
        "publishedAt": published,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "importedFrom": "rss-bridge-tiktok",
        "placeholder": False,
    }


def import_tiktok_posts(feed_url: str, repo_root: Path, existing: list[dict], limit: int, handle: str) -> list[dict]:
    feed_url = str(feed_url or "").strip()
    if not feed_url or limit <= 0:
        return []

    existing_by_url = {
        normalize_tiktok_url(str(item.get("url") or item.get("permalink") or "")): item
        for item in existing
        if normalize_tiktok_url(str(item.get("url") or item.get("permalink") or ""))
    }

    print(f"Fetching TikTok JSON feed: {feed_url}")
    try:
        response = requests.get(feed_url, timeout=60, headers={"User-Agent": BROWSER_UA, "Accept": "application/json,text/plain,*/*"})
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        print(f"WARN: TikTok feed import failed: {exc}", flush=True)
        return []

    raw_items = []
    if isinstance(payload, dict):
        for key in ("items", "posts", "entries"):
            if isinstance(payload.get(key), list):
                raw_items = payload[key]
                break
    elif isinstance(payload, list):
        raw_items = payload

    print(f"Raw TikTok feed items found: {len(raw_items)}")

    posts: list[dict] = []
    seen = set()
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        normalized = normalize_tiktok_item(raw, repo_root, existing_by_url, handle)
        if not normalized:
            continue
        key = normalize_tiktok_url(str(normalized.get("url") or "")) or normalized.get("id")
        if not key or key in seen:
            continue
        seen.add(key)
        posts.append(normalized)
        if len(posts) >= limit:
            break

    print(f"Usable TikTok posts imported: {len(posts)}")
    return posts

def merge_social_posts(existing: list[dict], imported_instagram: list[dict], imported_tiktok: list[dict]) -> list[dict]:
    # Replace a platform only when the import for that platform produced usable posts.
    # This prevents a temporary widget/RSS failure from deleting the previous cards.
    replace_instagram = bool(imported_instagram)
    replace_tiktok = bool(imported_tiktok)

    kept = []
    for item in existing:
        platform = str(item.get("platform") or "").lower()
        if replace_instagram and "instagram" in platform:
            continue
        if replace_tiktok and "tiktok" in platform:
            continue
        kept.append(item)

    merged = imported_instagram + imported_tiktok + kept

    seen = set()
    unique = []
    for item in merged:
        platform = str(item.get("platform") or "").lower()
        raw_url = str(item.get("url") or item.get("permalink") or "")
        if "instagram" in platform:
            key = normalize_instagram_url(raw_url) or item.get("id")
        elif "tiktok" in platform:
            key = normalize_tiktok_url(raw_url) or item.get("id")
        else:
            key = raw_url or item.get("id")
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def source_order(source: str) -> list[str]:
    source = source.lower().strip()
    if source == "auto":
        return ["elfsight", "embedsocial"]
    if source == "both":
        return ["elfsight", "embedsocial"]
    if source in {"elfsight", "embedsocial"}:
        return [source]
    raise ValueError("--source must be one of: auto, both, elfsight, embedsocial")


def main() -> int:
    parser = argparse.ArgumentParser(description="Import latest Instagram posts from Elfsight/EmbedSocial widgets and TikTok posts from RSS-Bridge into content/social-feed.json.")
    parser.add_argument("--source", default="auto", choices=["auto", "both", "elfsight", "embedsocial"], help="auto/both = try Elfsight and EmbedSocial.")
    parser.add_argument("--elfsight-app-id", default=DEFAULT_ELFSIGHT_APP_ID)
    parser.add_argument("--embedsocial-ref", default=DEFAULT_EMBEDSOCIAL_REF)
    parser.add_argument("--feed", default="content/social-feed.json")
    parser.add_argument("--limit", type=int, default=12)
    parser.add_argument("--wait-ms", type=int, default=12000, help="Extra wait for external widget JavaScript rendering.")
    parser.add_argument("--instagram-handle", default=DEFAULT_HANDLE)
    # Backward-compatible arguments from older workflows.
    parser.add_argument("--instagram-feed-url", default="")
    parser.add_argument("--feed-url", default="")
    parser.add_argument("--tiktok-feed-url", default=DEFAULT_TIKTOK_FEED_URL)
    parser.add_argument("--tiktok-limit", type=int, default=12)
    parser.add_argument("--tiktok-handle", default=DEFAULT_TIKTOK_HANDLE)
    args = parser.parse_args()

    repo_root = Path.cwd()
    feed_path = repo_root / args.feed
    existing_payload = load_json(feed_path, {"updatedAt": "", "posts": []})
    old_posts, output_as_list = existing_posts(existing_payload)

    existing_by_url = {
        normalize_instagram_url(str(item.get("url") or item.get("permalink") or "")): item
        for item in old_posts
        if normalize_instagram_url(str(item.get("url") or item.get("permalink") or ""))
    }

    print(f"Existing social feed posts: {len(old_posts)}")
    raw_by_url: dict[str, dict] = {}
    source_hits: dict[str, int] = {}

    for source in source_order(args.source):
        raw_items = extract_posts_with_playwright(source, args.elfsight_app_id, args.embedsocial_ref, args.wait_ms)
        source_hits[source] = len(raw_items)
        print(f"Raw {source} Instagram candidates found: {len(raw_items)}")
        for raw in raw_items:
            if not isinstance(raw, dict):
                continue
            url = normalize_instagram_url(str(raw.get("url") or ""))
            if not url:
                continue
            raw["url"] = url
            raw.setdefault("_source", source)
            current = raw_by_url.get(url)
            if current is None or quality_score(raw) > quality_score(current):
                raw_by_url[url] = raw

    print(f"Unique Instagram candidates after dedupe: {len(raw_by_url)}")

    instagram_posts = []
    # Preserve discovery order as much as possible, but prefer higher-quality candidates first when dates are unavailable.
    sorted_raw = sorted(raw_by_url.values(), key=quality_score, reverse=True)
    for raw in sorted_raw:
        source = str(raw.get("_source") or "widget")
        normalized = normalize_item(raw, repo_root, existing_by_url, args.instagram_handle, source)
        if not normalized:
            continue
        instagram_posts.append(normalized)
        if len(instagram_posts) >= args.limit:
            break

    print(f"Usable Instagram posts imported from widgets: {len(instagram_posts)}")

    if not instagram_posts:
        print("WARN: no usable Instagram posts found from Elfsight/EmbedSocial. Keeping existing Instagram posts unchanged.")

    tiktok_posts = import_tiktok_posts(
        feed_url=args.tiktok_feed_url,
        repo_root=repo_root,
        existing=old_posts,
        limit=args.tiktok_limit,
        handle=args.tiktok_handle or DEFAULT_TIKTOK_HANDLE,
    )

    if not instagram_posts and not tiktok_posts:
        print("WARN: no usable Instagram or TikTok posts found. Keeping existing feed unchanged.")
        return 0

    new_posts = merge_social_posts(old_posts, instagram_posts, tiktok_posts)

    if output_as_list:
        new_payload = new_posts
    else:
        new_payload = {
            **(existing_payload if isinstance(existing_payload, dict) else {}),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "instagramSource": args.source,
            "elfsightAppId": args.elfsight_app_id,
            "embedSocialRef": args.embedsocial_ref,
            "tiktokFeedUrl": args.tiktok_feed_url,
            "sourceHits": {**source_hits, "tiktok": len(tiktok_posts)},
            "posts": new_posts,
        }
        # Remove old source metadata from previous importers.
        for old_key in ("items", "instagramFeedUrl", "po" + "wrUrl", "instagramSourceUrl"):
            new_payload.pop(old_key, None)

    before = json.dumps(existing_payload, ensure_ascii=False, sort_keys=True)
    after = json.dumps(new_payload, ensure_ascii=False, sort_keys=True)

    if before == after:
        print("No social feed changes.")
        return 0

    save_json(feed_path, new_payload)
    print(f"Total social feed posts now: {len(new_posts)}")
    print("Images saved under img/social when available.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
