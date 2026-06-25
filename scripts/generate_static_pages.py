#!/usr/bin/env python3
"""Generate SEO-friendly static entry pages for the CUS Trento C5 site.

The JavaScript app remains the interactive runtime. This script reads the same
JSON content used by the app and writes prerendered HTML pages, sitemap.xml and
robots.txt so crawlers and social previews can see stable clean URLs.
"""
from __future__ import annotations

import html
import json
import os
import re
import shutil
import unicodedata
import xml.sax.saxutils as xml_escape
from datetime import date
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

ROOT = Path(__file__).resolve().parents[1]
SITE_URL = os.environ.get("SITE_URL", "https://custrentocalcioa5.it").rstrip("/")
TEMPLATE_PATH = ROOT / "index.html"
TODAY = date.today().isoformat()

CMS_FILES = [
    "content/cms/news.json",
    "content/cms/roster.json",
    "content/cms/fixtures.json",
    "content/cms/u21-fixtures.json",
    "content/cms/gallery-albums.json",
    "content/cms/sponsors.json",
    "content/cms/sponsor-packages.json",
    "content/cms/staff.json",
    "content/cms/videos.json",
    "content/cms/club-history.json",
]

GENERATED_DIRS = [
    "news",
    "squadra",
    "staff",
    "calendario",
    "classifica",
    "statistiche",
    "coppa",
    "matchday",
    "gallery",
    "video",
    "social",
    "club",
    "sponsor",
    "hall-of-fame",
    "contatti",
    "privacy",
    "cookies",
    "under-21",
]

MAIN_PAGES = [
    {
        "path": "/news/",
        "route": "news",
        "title": "News CUS Trento C5",
        "description": "News, match report e storie ufficiali dal CUS Trento Calcio a 5.",
        "heading": "News, match report e storie dal club",
        "eyebrow": "Media center",
    },
    {
        "path": "/squadra/",
        "route": "squad",
        "title": "Rosa CUS Trento C5",
        "description": "Rosa della prima squadra e dell'Under 21 del CUS Trento Calcio a 5.",
        "heading": "Rosa",
        "eyebrow": "Team",
    },
    {
        "path": "/staff/",
        "route": "staff",
        "title": "Staff tecnico CUS Trento C5",
        "description": "Staff tecnico e dirigenziale del CUS Trento Calcio a 5.",
        "heading": "Staff tecnico",
        "eyebrow": "Club",
    },
    {
        "path": "/calendario/",
        "route": "fixtures",
        "title": "Calendario CUS Trento C5",
        "description": "Calendario, risultati e partite del CUS Trento Calcio a 5.",
        "heading": "Calendario e risultati",
        "eyebrow": "Stagione",
    },
    {
        "path": "/classifica/",
        "route": "standings",
        "title": "Classifica CUS Trento C5",
        "description": "Classifica aggiornata della stagione del CUS Trento Calcio a 5.",
        "heading": "Classifica",
        "eyebrow": "Stagione",
    },
    {
        "path": "/statistiche/",
        "route": "stats",
        "title": "Statistiche CUS Trento C5",
        "description": "Statistiche giocatori, marcatori e andamento del CUS Trento Calcio a 5.",
        "heading": "Statistiche",
        "eyebrow": "Data room",
    },
    {
        "path": "/coppa/",
        "route": "coppa",
        "title": "Coppa CUS Trento C5",
        "description": "Percorso, calendario e risultati di Coppa del CUS Trento Calcio a 5.",
        "heading": "Coppa",
        "eyebrow": "Stagione",
    },
    {
        "path": "/matchday/",
        "route": "matchday",
        "title": "Matchday CUS Trento C5",
        "description": "Informazioni utili per seguire le partite casalinghe del CUS Trento C5.",
        "heading": "Matchday",
        "eyebrow": "Info partita",
    },
    {
        "path": "/gallery/",
        "route": "gallery",
        "title": "Gallery CUS Trento C5",
        "description": "Foto, album e contenuti multimediali del CUS Trento Calcio a 5.",
        "heading": "Gallery",
        "eyebrow": "Media",
    },
    {
        "path": "/video/",
        "route": "video",
        "title": "Video CUS Trento C5",
        "description": "Video ufficiali e contenuti multimediali del CUS Trento Calcio a 5.",
        "heading": "Video",
        "eyebrow": "Media",
    },
    {
        "path": "/social/",
        "route": "social",
        "title": "Social wall CUS Trento C5",
        "description": "Ultimi contenuti social Instagram e TikTok del CUS Trento C5.",
        "heading": "Social wall",
        "eyebrow": "Community",
    },
    {
        "path": "/club/",
        "route": "club",
        "title": "Club CUS Trento C5",
        "description": "Storia, identità e progetto sportivo del CUS Trento Calcio a 5.",
        "heading": "CUS Trento C5: storia e identità",
        "eyebrow": "Identity",
    },
    {
        "path": "/sponsor/",
        "route": "sponsor",
        "title": "Sponsor CUS Trento C5",
        "description": "Partner, sponsor e opportunità di collaborazione con il CUS Trento C5.",
        "heading": "Sponsor e partnership",
        "eyebrow": "Business club",
    },
    {
        "path": "/hall-of-fame/",
        "route": "records",
        "title": "Hall of fame CUS Trento C5",
        "description": "Record storici, presenze e marcatori del CUS Trento Calcio a 5.",
        "heading": "Hall of fame",
        "eyebrow": "Records",
    },
    {
        "path": "/contatti/",
        "route": "contacts",
        "title": "Contatti CUS Trento C5",
        "description": "Contatti ufficiali del CUS Trento Calcio a 5.",
        "heading": "Contatti",
        "eyebrow": "Club",
    },
    {
        "path": "/privacy/",
        "route": "privacy",
        "title": "Privacy Policy CUS Trento C5",
        "description": "Informativa privacy del sito CUS Trento Calcio a 5.",
        "heading": "Privacy Policy",
        "eyebrow": "Legal",
    },
    {
        "path": "/cookies/",
        "route": "cookies",
        "title": "Cookie Policy CUS Trento C5",
        "description": "Cookie policy del sito CUS Trento Calcio a 5.",
        "heading": "Cookie Policy",
        "eyebrow": "Legal",
    },
    {
        "path": "/under-21/",
        "route": "u21",
        "title": "Under 21 CUS Trento C5",
        "description": "Sezione Under 21 del CUS Trento Calcio a 5.",
        "heading": "Under 21",
        "eyebrow": "Team",
    },
]


def read_json(path: str, default: Any) -> Any:
    full = ROOT / path
    if not full.exists():
        return default
    try:
        return json.loads(full.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {path}: {exc}") from exc


def slugify(value: Any, limit: int = 86) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    if not text:
        text = "news"
    return text[:limit].strip("-") or "news"


def news_slug(item: Dict[str, Any]) -> str:
    raw_id = item.get("id") or item.get("sourceId") or item.get("date") or "item"
    return f"{slugify(item.get('title') or 'news')}-{slugify(raw_id, 32)}"


def news_url(item: Dict[str, Any]) -> str:
    return f"/news/{news_slug(item)}/"


def canonical(path: str) -> str:
    return f"{SITE_URL}{path if path.startswith('/') else '/' + path}"


def esc(value: Any) -> str:
    return html.escape(str(value or ""), quote=True)


def text_excerpt(value: Any, max_len: int = 156) -> str:
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def valid_date(value: Any) -> str:
    text = str(value or "").strip()[:10]
    return text if re.match(r"^\d{4}-\d{2}-\d{2}$", text) else TODAY


def load_site_data() -> Dict[str, Any]:
    base = read_json("content/data.json", {})
    if not isinstance(base, dict):
        base = {}
    data = dict(base)

    for rel in CMS_FILES:
        payload = read_json(rel, {})
        if isinstance(payload, dict):
            for key, value in payload.items():
                data[key] = value

    imported_index = read_json("content/news.index.json", {})
    imported_full = read_json("content/news.imported.json", {})
    index_news = imported_index.get("news", []) if isinstance(imported_index, dict) else imported_index if isinstance(imported_index, list) else []
    full_news = imported_full.get("news", []) if isinstance(imported_full, dict) else imported_full if isinstance(imported_full, list) else []
    cms_news = data.get("news", []) if isinstance(data.get("news"), list) else []

    full_by_key: Dict[str, Dict[str, Any]] = {}
    for item in full_news:
        if isinstance(item, dict):
            key = str(item.get("sourceUrl") or item.get("sourceId") or item.get("id") or f"{item.get('title')}|{item.get('date')}")
            full_by_key[key] = item

    merged: List[Dict[str, Any]] = []
    seen = set()
    for source in [cms_news, index_news]:
        for item in source:
            if not isinstance(item, dict):
                continue
            key = str(item.get("sourceUrl") or item.get("sourceId") or item.get("id") or f"{item.get('title')}|{item.get('date')}")
            if key in seen:
                continue
            seen.add(key)
            full = full_by_key.get(key)
            merged.append({**item, **full} if full else item)

    data["news"] = sorted(merged, key=lambda n: (str(n.get("date") or ""), int(n.get("id") or 0) if str(n.get("id") or "").isdigit() else 0), reverse=True)
    return data


def page_template(title: str, description: str, path: str, image: str | None, prerender_html: str) -> str:
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    image_url = image or f"{SITE_URL}/assets/foto-sito.webp?auto=format&fit=crop&w=2200&q=80"
    replacements = [
        (r"<title[^>]*>.*?</title>", f"<title>{esc(title)} | CUS Trento C5</title>"),
        (r'<meta id="metaDescription" name="description" content="[^"]*"/?>', f'<meta id="metaDescription" name="description" content="{esc(description)}"/>'),
        (r'<meta id="ogTitle" property="og:title" content="[^"]*"/?>', f'<meta id="ogTitle" property="og:title" content="{esc(title)}"/>'),
        (r'<meta id="ogDescription" property="og:description" content="[^"]*"/?>', f'<meta id="ogDescription" property="og:description" content="{esc(description)}"/>'),
        (r'<meta id="ogImage" property="og:image" content="[^"]*"/?>', f'<meta id="ogImage" property="og:image" content="{esc(image_url)}"/>'),
        (r'<link id="canonical" rel="canonical" href="[^"]*"/?>', f'<link id="canonical" rel="canonical" href="{esc(canonical(path))}"/>'),
        (r'<main id="app"></main>', f'<main id="app" data-prerendered="true">\n{prerender_html}\n</main>'),
    ]
    html_out = template
    for pattern, replacement in replacements:
        html_out = re.sub(pattern, replacement, html_out, count=1, flags=re.S)
    return html_out


def write_page(path: str, html_content: str) -> None:
    normalized = path.strip("/")
    out_dir = ROOT / normalized if normalized else ROOT
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "index.html").write_text(html_content, encoding="utf-8")


def remove_generated_dirs() -> None:
    for rel in GENERATED_DIRS:
        target = ROOT / rel
        if target.exists():
            shutil.rmtree(target)


def render_shell(eyebrow: str, heading: str, body: str) -> str:
    return f'''<section class="section seo-prerender"><div class="container"><div class="head"><div><span class="eyebrow">{esc(eyebrow)}</span><h1 class="title">{esc(heading)}</h1></div></div>{body}</div></section>'''


def render_news_teasers(news: List[Dict[str, Any]], limit: int = 36) -> str:
    cards = []
    for item in news[:limit]:
        url = news_url(item)
        img = item.get("image") or ""
        cards.append(
            f'''<article class="card news-card"><a href="{esc(url)}" aria-label="Leggi {esc(item.get('title'))}">'''
            f'''{f'<img loading="lazy" decoding="async" src="{esc(img)}" alt="{esc(item.get("title"))}">' if img else ''}'''
            f'''<div class="card-pad"><div class="news-meta">{esc(valid_date(item.get('date')))} · {esc(item.get('author') or 'Redazione')}</div>'''
            f'''<h2>{esc(item.get('title'))}</h2><p class="muted">{esc(text_excerpt(item.get('excerpt') or item.get('body') or ''))}</p>'''
            f'''<span class="btn soft">Leggi →</span></div></a></article>'''
        )
    return '<div class="grid grid-3">' + "\n".join(cards) + "</div>"


def render_simple_main(page: Dict[str, Any], data: Dict[str, Any]) -> str:
    route = page["route"]
    pieces: List[str] = []
    if route == "news":
        pieces.append("<p class=\"muted\">Le ultime notizie pubblicate dal club e importate dall'archivio SporTrentino.</p>")
        pieces.append(render_news_teasers(data.get("news", [])))
    elif route == "squad":
        roster = data.get("roster", []) if isinstance(data.get("roster"), list) else []
        pieces.append("<div class=\"grid grid-4\">" + "\n".join(
            f'''<article class="card player"><div class="player-top"><div class="avatar"><img loading="lazy" decoding="async" src="{esc(p.get('photo') or '/img/placeholder.webp')}" alt="{esc(p.get('name'))}"></div></div><div class="card-pad"><span class="badge">{esc(p.get('role'))}</span><h2>{esc(p.get('name'))}</h2><p class="muted">{esc(p.get('team'))}</p></div></article>'''
            for p in roster[:24] if isinstance(p, dict)
        ) + "</div>")
    elif route == "staff":
        staff = data.get("staff", []) if isinstance(data.get("staff"), list) else []
        pieces.append("<div class=\"grid grid-3\">" + "\n".join(
            f'''<article class="card card-pad"><h2>{esc(s.get('name'))}</h2><p class="muted">{esc(s.get('role'))} · {esc(s.get('team'))}</p></article>'''
            for s in staff if isinstance(s, dict)
        ) + "</div>")
    elif route in {"fixtures", "coppa"}:
        fixtures = data.get("fixtures", []) if isinstance(data.get("fixtures"), list) else []
        pieces.append("<div class=\"grid\">" + "\n".join(
            f'''<article class="fixture"><div class="fixture-top"><span>{esc(valid_date(f.get('date')))} · {esc(f.get('time') or '--:--')}</span><span>{esc(f.get('status') or '')}</span></div><div class="teams"><span>{esc(f.get('home'))}</span><span class="score">{esc(f.get('score') or 'VS')}</span><span>{esc(f.get('away'))}</span></div><p class="muted">{esc(f.get('venue'))} · {esc(f.get('competition') or '')}</p></article>'''
            for f in fixtures[:20] if isinstance(f, dict)
        ) + "</div>")
    elif route == "standings":
        rows = data.get("standings", []) if isinstance(data.get("standings"), list) else []
        table = "".join(
            f'''<tr><td>{esc(r.get('pos'))}</td><td>{esc(r.get('team'))}</td><td>{esc(r.get('pts'))}</td><td>{esc(r.get('g'))}</td></tr>'''
            for r in rows if isinstance(r, dict)
        )
        pieces.append(f'<div class="card card-pad table-wrap"><table class="table"><thead><tr><th>#</th><th>Squadra</th><th>Pt</th><th>G</th></tr></thead><tbody>{table}</tbody></table></div>')
    elif route == "gallery":
        albums = data.get("galleryAlbums", []) if isinstance(data.get("galleryAlbums"), list) else []
        pieces.append("<div class=\"grid grid-3\">" + "\n".join(
            f'''<article class="card card-pad"><h2>{esc(a.get('title'))}</h2><p class="muted">{esc(a.get('season') or '')}</p></article>'''
            for a in albums if isinstance(a, dict)
        ) + "</div>")
    else:
        latest = render_news_teasers(data.get("news", []), limit=6)
        pieces.append(f'<p class="muted">Pagina ufficiale CUS Trento Calcio a 5. Il sito interattivo caricherà contenuti completi, filtri e componenti dinamici.</p>{latest}')

    pieces.append('<p class="muted" style="margin-top:24px">Questa pagina è prerenderizzata per SEO. Se il browser supporta JavaScript, verrà attivata automaticamente la versione interattiva.</p>')
    return render_shell(page["eyebrow"], page["heading"], "\n".join(pieces))


def article_body_html(item: Dict[str, Any]) -> str:
    parts: List[str] = []
    if item.get("image"):
        parts.append(f'<img class="article-hero" loading="eager" decoding="async" src="{esc(item.get("image"))}" alt="{esc(item.get("title"))}">')

    if isinstance(item.get("contentBlocks"), list):
        for block in item["contentBlocks"]:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "image" and block.get("image"):
                parts.append(f'<figure class="imported-figure"><img loading="lazy" decoding="async" src="{esc(block.get("image"))}" alt="{esc(block.get("caption") or item.get("title"))}">{f"<figcaption>{esc(block.get('caption'))}</figcaption>" if block.get("caption") else ""}</figure>')
            elif block.get("text"):
                parts.append(f'<p>{esc(block.get("text"))}</p>')
    elif isinstance(item.get("body"), list) and item.get("body"):
        seen = set()
        for para in item["body"]:
            text = re.sub(r"\s+", " ", str(para or "")).strip()
            if not text:
                continue
            key = text[:280]
            if key in seen:
                continue
            seen.add(key)
            parts.append(f"<p>{esc(text)}</p>")
    elif isinstance(item.get("body"), str) and item.get("body").strip():
        for para in re.split(r"\n{2,}", item["body"]):
            text = para.strip()
            if text:
                parts.append(f"<p>{esc(text)}</p>")
    elif item.get("bodyHtml"):
        clean = re.sub(r"<script[\s\S]*?</script>", "", str(item["bodyHtml"]), flags=re.I)
        clean = re.sub(r"<style[\s\S]*?</style>", "", clean, flags=re.I)
        parts.append(clean)
    else:
        parts.append(f'<p>{esc(item.get("excerpt") or "")}</p>')

    if item.get("sourceUrl"):
        parts.append(f'<div class="source-box"><b>Fonte:</b> <a href="{esc(item.get("sourceUrl"))}" target="_blank" rel="noopener noreferrer">{esc(item.get("sourceName") or "SporTrentino.it")}</a></div>')
    return "\n".join(parts)


def render_article(item: Dict[str, Any]) -> str:
    title = item.get("title") or "News CUS Trento C5"
    date_s = valid_date(item.get("date"))
    author = item.get("author") or "Redazione"
    tags = item.get("tags") if isinstance(item.get("tags"), list) else []
    tag_values = []
    for tag in [item.get("category"), *tags]:
        if tag and tag not in tag_values:
            tag_values.append(tag)
    tag_html = "".join(f'<span class="badge">{esc(tag)}</span>' for tag in tag_values)
    body = f'''
    <div class="breadcrumb"><a class="back-link" href="/news/"><span>←</span> News</a><span>{esc(date_s)} · {esc(author)}</span></div>
    <div class="badge-row" style="margin:0 0 14px">{tag_html}</div>
    <div class="grid grid" style="margin-top:28px"><article class="card card-pad article-body imported-article">
      {article_body_html(item)}
    </article></div>
    '''
    return render_shell(item.get("category") or "News", title, body)


def generate_main_pages(data: Dict[str, Any], urls: List[Tuple[str, str]]) -> None:
    for page in MAIN_PAGES:
        html_out = page_template(page["title"], page["description"], page["path"], None, render_simple_main(page, data))
        write_page(page["path"], html_out)
        urls.append((page["path"], TODAY))


def generate_news_pages(data: Dict[str, Any], urls: List[Tuple[str, str]]) -> None:
    for item in data.get("news", []):
        if not isinstance(item, dict):
            continue
        path = news_url(item)
        title = item.get("title") or "News CUS Trento C5"
        description = text_excerpt(item.get("excerpt") or item.get("body") or title)
        html_out = page_template(title, description, path, item.get("image"), render_article(item))
        write_page(path, html_out)
        urls.append((path, valid_date(item.get("date"))))


def write_robots() -> None:
    (ROOT / "robots.txt").write_text(
        f"User-agent: *\nAllow: /\n\nSitemap: {SITE_URL}/sitemap.xml\n",
        encoding="utf-8",
    )


def write_sitemap(urls: Iterable[Tuple[str, str]]) -> None:
    dedup: Dict[str, str] = {"/": TODAY}
    for path, lastmod in urls:
        dedup[path] = lastmod or TODAY
    body = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for path, lastmod in sorted(dedup.items(), key=lambda x: (x[0] != "/", x[0])):
        body.append("  <url>")
        body.append(f"    <loc>{xml_escape.escape(canonical(path))}</loc>")
        body.append(f"    <lastmod>{esc(lastmod)}</lastmod>")
        body.append("  </url>")
    body.append("</urlset>")
    (ROOT / "sitemap.xml").write_text("\n".join(body) + "\n", encoding="utf-8")


def main() -> None:
    data = load_site_data()
    remove_generated_dirs()
    urls: List[Tuple[str, str]] = []
    generate_main_pages(data, urls)
    generate_news_pages(data, urls)
    write_robots()
    write_sitemap(urls)
    print(f"Generated {len(data.get('news', []))} news pages, {len(MAIN_PAGES)} main pages, sitemap.xml and robots.txt")


if __name__ == "__main__":
    main()
