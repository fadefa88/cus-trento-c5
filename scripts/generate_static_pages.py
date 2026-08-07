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
SITE_URL = os.environ.get("SITE_URL", "https://calcioa5.custrento.it").rstrip("/")
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
    "content/cms/events.json",
]

GENERATED_DIRS = [
    "news",
    "squadra",
    "staff",
    "calendario",
    "eventi",
    "partner",
    "diventa-partner",
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
        "description": "Storia e progetto sportivo del CUS Trento Calcio a 5.",
        "heading": "Chi siamo",
        "eyebrow": "Club",
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
    {
        "path": "/squadre/",
        "route": "teams-overview",
        "title": "Squadre CUS Trento C5",
        "description": "Prima squadra e Under 21 del CUS Trento C5.",
        "heading": "Squadre",
        "eyebrow": "Team",
    },
    {
        "path": "/gioca-con-noi/",
        "route": "play-with-us",
        "title": "Gioca con noi CUS Trento C5",
        "description": "Candidature e informazioni per giocare nel CUS Trento C5.",
        "heading": "Gioca con noi",
        "eyebrow": "Squadre",
    },
    {
        "path": "/cnu/",
        "route": "cnu",
        "title": "CNU CUS Trento C5",
        "description": "Campionati Nazionali Universitari del CUS Trento C5.",
        "heading": "CNU",
        "eyebrow": "Stagione",
    },
    {
        "path": "/archivio-stagioni/",
        "route": "season-archive",
        "title": "Archivio stagioni CUS Trento C5",
        "description": "Archivio storico delle stagioni del CUS Trento C5.",
        "heading": "Archivio stagioni",
        "eyebrow": "Stagione",
    },
    {
        "path": "/eventi/",
        "route": "events",
        "title": "Eventi CUS Trento C5",
        "description": "Eventi, tornei e selezioni del CUS Trento C5.",
        "heading": "Eventi",
        "eyebrow": "Eventi",
    },
    {
        "path": "/partner/",
        "route": "partner",
        "title": "Partner CUS Trento C5",
        "description": "Partner e sponsor del CUS Trento C5.",
        "heading": "Partner",
        "eyebrow": "Partner",
    },
    {
        "path": "/diventa-partner/",
        "route": "become-partner",
        "title": "Diventa partner CUS Trento C5",
        "description": "Pacchetti e opportunità per diventare partner del CUS Trento C5.",
        "heading": "Diventa partner",
        "eyebrow": "Partner",
    },
    {
        "path": "/impianto/",
        "route": "venue",
        "title": "Palazzetto Sanbàpolis CUS Trento C5",
        "description": "Impianto e casa del CUS Trento C5.",
        "heading": "Palazzetto Sanbàpolis",
        "eyebrow": "Club",
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


AUTO_OBJECT_FIELDS = {
    "news": ["title", "date"],
    "roster": ["name"],
    "fixtures": ["home", "away", "date"],
    "u21Fixtures": ["home", "away", "date"],
    "galleryAlbums": ["title", "season", "date"],
    "sponsors": ["name"],
    "sponsorPackages": ["name"],
    "staff": ["name", "role"],
    "videos": ["title"],
    "events": ["title", "date"],
}

ITEM_URL_BASES = {
    "news": "/news/",
    "roster": "/squadra/",
    "fixtures": "/calendario/",
    "u21Fixtures": "/under-21/calendario/",
    "galleryAlbums": "/gallery/",
    "sponsors": "/partner/",
    "sponsorPackages": "/diventa-partner/",
    "staff": "/staff/",
    "videos": "/video/",
    "events": "/eventi/",
}


def object_id_base(item: Dict[str, Any], fields: List[str]) -> str:
    direct = " ".join(str(item.get(field) or "") for field in fields).strip()
    return direct or str(item.get("name") or item.get("title") or item.get("home") or item.get("away") or item.get("date") or item.get("season") or "item")


def unique_slug(base: Any, used: set[str], limit: int = 86) -> str:
    root = slugify(base, limit)
    candidate = root
    counter = 2
    while candidate in used:
        candidate = f"{root}-{counter}"
        counter += 1
    used.add(candidate)
    return candidate


def ensure_object_ids_and_slugs(items: Any, fields: List[str]) -> Any:
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
            out["id"] = unique_slug(current_id or object_id_base(out, fields), used_ids, 72)

        current_slug = str(out.get("slug") or "").strip()
        out["slug"] = unique_slug(current_slug or object_id_base(out, fields), used_slugs, 86)
        normalized.append(out)
    return normalized


def normalize_automatic_ids(data: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(data or {})
    for key, fields in AUTO_OBJECT_FIELDS.items():
        if isinstance(out.get(key), list):
            out[key] = ensure_object_ids_and_slugs(out[key], fields)
    if isinstance(out.get("clubHistory"), dict) and isinstance(out["clubHistory"].get("images"), list):
        out["clubHistory"] = dict(out["clubHistory"])
        out["clubHistory"]["images"] = ensure_object_ids_and_slugs(out["clubHistory"].get("images"), ["season"])
    return out


def item_slug(item: Dict[str, Any], key: str) -> str:
    fields = AUTO_OBJECT_FIELDS.get(key, ["title", "name", "date"])
    return slugify(item.get("slug") or object_id_base(item, fields))


def item_url(key: str, item: Dict[str, Any]) -> str:
    return f"{ITEM_URL_BASES[key]}{item_slug(item, key)}/"


def legacy_news_slug(item: Dict[str, Any]) -> str:
    raw_id = item.get("id") or item.get("sourceId") or item.get("date") or "item"
    return f"{slugify(item.get('title') or 'news')}-{slugify(raw_id, 32)}"


def news_slug(item: Dict[str, Any]) -> str:
    return slugify(item.get("slug") or legacy_news_slug(item))


def news_url(item: Dict[str, Any]) -> str:
    return item_url("news", item)


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

    data = normalize_automatic_ids(data)

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
    data["news"] = ensure_object_ids_and_slugs(data["news"], AUTO_OBJECT_FIELDS["news"])
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
    elif route == "season-archive":
        rows = []
        hs = data.get("historicalStats") if isinstance(data.get("historicalStats"), dict) else {}
        if isinstance(hs.get("seasons"), list):
            rows = hs.get("seasons", [])
        elif isinstance(data.get("seasons"), list):
            rows = data.get("seasons", [])
        def comp_for(season: Any) -> str:
            mapping = {
                "2011/2012":"Serie D", "2012/2013":"Serie D", "2013/2014":"Serie D", "2014/2015":"Serie C2", "2015/2016":"Serie D", "2016/2017":"Serie D", "2017/2018":"Serie C2", "2018/2019":"Serie C2", "2019/2020":"Serie C2", "2020/2021":"Serie C2", "2021/2022":"Serie C1", "2022/2023":"Serie C1", "2023/2024":"Serie C1", "2024/2025":"Serie C1", "2025/2026":"Serie C1", "2026/2027":"Serie B - Gir. B"
            }
            key = str(season or "").replace(" ", "")
            if key in mapping:
                return mapping[key]
            match = re.match(r"^(\d{4})/(\d{2})$", key)
            if match:
                return mapping.get(f"{match.group(1)}/20{match.group(2)}", "")
            return ""
        table = "".join(
            f'''<tr><td>{esc(r.get('season'))}</td><td>{esc(r.get('competition') or comp_for(r.get('season')) or '-')}</td><td>{esc(r.get('played') or '-')}</td><td>{esc(r.get('wins') or '-')}</td><td>{esc(r.get('draws') or '-')}</td><td>{esc(r.get('losses') or '-')}</td><td>{esc(r.get('goalsFor') or '-')}</td><td>{esc(r.get('goalsAgainst') or '-')}</td><td>{esc(r.get('goalDifference') if r.get('goalDifference') is not None else '-')}</td></tr>'''
            for r in rows if isinstance(r, dict)
        )
        pieces.append(f'<div class="card card-pad table-wrap"><table class="table"><thead><tr><th>Stagione</th><th>Campionato</th><th>Gare</th><th>V</th><th>N</th><th>P</th><th>GF</th><th>GS</th><th>Diff.</th></tr></thead><tbody>{table}</tbody></table></div>')
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


def item_title(key: str, item: Dict[str, Any]) -> str:
    if key in {"fixtures", "u21Fixtures"}:
        return f"{item.get('home') or 'CUS Trento'} - {item.get('away') or 'Avversario'}"
    return str(item.get("title") or item.get("name") or item.get("season") or "CUS Trento C5")


def item_description(key: str, item: Dict[str, Any]) -> str:
    values = [
        item.get("excerpt"), item.get("summary"), item.get("description"), item.get("bio"),
        item.get("role"), item.get("team"), item.get("type"), item.get("date"), item.get("venue")
    ]
    if key in {"fixtures", "u21Fixtures"}:
        values = [item_title(key, item), item.get("competition"), item.get("round"), item.get("venue"), item.get("date")]
    if key == "sponsorPackages":
        values = [item.get("name"), item.get("price"), "Pacchetto partner CUS Trento C5"]
    text = " · ".join(str(v) for v in values if v)
    return text_excerpt(text or item_title(key, item), 156)


def item_image(key: str, item: Dict[str, Any]) -> str | None:
    return item.get("image") or item.get("photo") or item.get("cover") or item.get("thumb") or item.get("logo")


def render_object_page(key: str, item: Dict[str, Any]) -> str:
    title = item_title(key, item)
    crumbs = {
        "roster": ("/squadra/", "Rosa"),
        "staff": ("/staff/", "Staff"),
        "fixtures": ("/calendario/", "Calendario"),
        "u21Fixtures": ("/calendario/", "Calendario"),
        "galleryAlbums": ("/gallery/", "Gallery"),
        "sponsors": ("/partner/", "Partner"),
        "sponsorPackages": ("/diventa-partner/", "Diventa partner"),
        "videos": ("/video/", "Video"),
        "events": ("/eventi/", "Eventi"),
    }.get(key, ("/", "CUS Trento C5"))
    details: List[str] = []
    for label, field in [
        ("Ruolo", "role"), ("Squadra/Gruppo", "team"), ("Numero", "number"), ("Categoria", "category"),
        ("Tipo", "type"), ("Data", "date"), ("Orario", "time"), ("Luogo", "venue"), ("Prezzo", "price"),
    ]:
        if item.get(field) not in (None, ""):
            details.append(f'<div class="player-info-box"><span>{esc(label)}</span><b>{esc(item.get(field))}</b></div>')
    body_bits: List[str] = []
    if key == "galleryAlbums":
        photos = item.get("photos") if isinstance(item.get("photos"), list) else []
        body_bits.append('<div class="grid grid-3">' + "".join(
            f'<article class="card"><img loading="lazy" class="gallery-img" src="{esc(photo if isinstance(photo, str) else photo.get("url") or photo.get("image") or photo.get("src") or "")}" alt="{esc(title)}"></article>'
            for photo in photos[:24]
        ) + '</div>')
    elif key == "videos" and item.get("url"):
        body_bits.append(f'<p><a class="btn dark" href="{esc(item.get("url"))}" target="_blank" rel="noopener noreferrer">Apri video</a></p>')
    elif key == "sponsors" and item.get("url"):
        body_bits.append(f'<p><a class="btn dark" href="{esc(item.get("url"))}" target="_blank" rel="noopener noreferrer">Visita sito partner</a></p>')
    elif key == "sponsorPackages":
        vis = item.get("visibility") if isinstance(item.get("visibility"), list) else []
        if vis:
            body_bits.append('<ul>' + ''.join(f'<li>{esc(v)}</li>' for v in vis) + '</ul>')
    body_bits.append(f'<p>{esc(item.get("details") or item.get("description") or item.get("summary") or item.get("bio") or item.get("excerpt") or "Scheda in aggiornamento.")}</p>')
    image = item_image(key, item)
    image_html = f'<img class="article-hero" loading="eager" decoding="async" src="{esc(image)}" alt="{esc(title)}">' if image else ""
    body = (
        f'<div class="breadcrumb"><a class="back-link" href="{esc(crumbs[0])}"><span>←</span> {esc(crumbs[1])}</a><span>{esc(item.get("slug") or "")}</span></div>'
        f'<div class="grid grid-2" style="margin-top:28px">'
        f'<article class="card card-pad article-body imported-article">{image_html}{"".join(body_bits)}</article>'
        f'<aside class="card card-pad"><h2>Dettagli</h2><div class="player-info-grid">{"".join(details) or "<p class=\"muted\">Dettagli in aggiornamento.</p>"}</div></aside>'
        f'</div>'
    )
    return render_shell(crumbs[1], title, body)


def generate_object_pages(data: Dict[str, Any], urls: List[Tuple[str, str]]) -> None:
    for key in ["roster", "staff", "fixtures", "u21Fixtures", "galleryAlbums", "sponsors", "sponsorPackages", "videos", "events"]:
        items = data.get(key, []) if isinstance(data.get(key), list) else []
        for item in items:
            if not isinstance(item, dict):
                continue
            path = item_url(key, item)
            title = item_title(key, item)
            description = item_description(key, item)
            html_out = page_template(title, description, path, item_image(key, item), render_object_page(key, item))
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
    generate_object_pages(data, urls)
    write_robots()
    write_sitemap(urls)
    print(f"Generated {len(data.get('news', []))} news pages, object slug pages, {len(MAIN_PAGES)} main pages, sitemap.xml and robots.txt")


if __name__ == "__main__":
    main()
