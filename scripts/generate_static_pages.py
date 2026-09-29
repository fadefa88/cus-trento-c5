#!/usr/bin/env python3
"""Generate SEO-friendly static entry pages for the CUS Trento C5 site.

The JavaScript app remains the interactive runtime. This script reads the same
JSON content used by the app and writes prerendered HTML pages, sitemap.xml,
robots.txt and _redirects so crawlers and social previews can see stable clean
URLs.

Routes, collections and slug rules come from js/site-core.js via
scripts/site_data.py. `--list-output-dirs` prints the top-level directories this
generator owns, which the Cloudflare build publishes.
"""
from __future__ import annotations

import html
import os
import re
import shutil
import sys
import xml.sax.saxutils as xml_escape
from datetime import date
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

from site_data import (
    COLLECTIONS,
    CONFIG,
    ROOT,
    is_hidden_news,
    item_path,
    load_site_data,
    public_youth_text,
    season_competition,
)

SITE_URL = os.environ.get("SITE_URL", CONFIG["siteUrl"]).rstrip("/")
TEMPLATE_PATH = ROOT / "index.html"
TODAY = date.today().isoformat()
MAIN_PAGES: List[Dict[str, str]] = CONFIG["pages"]
OBJECT_COLLECTIONS = [key for key in COLLECTIONS if key != "news"]


def top_level_dir(path: str) -> str:
    return path.strip("/").split("/")[0]


def output_dirs() -> List[str]:
    """Top-level directories whose content is entirely written by this script."""
    paths = [page["path"] for page in MAIN_PAGES] + [c["urlBase"] for c in COLLECTIONS.values()]
    return sorted({top_level_dir(p) for p in paths if top_level_dir(p)})


def stale_dirs() -> List[str]:
    """Redirect sources must not keep an old prerendered page."""
    owned = set(output_dirs())
    return sorted({top_level_dir(r["from"]) for r in CONFIG["redirects"]} - owned)


def canonical(path: str) -> str:
    return f"{SITE_URL}{path if path.startswith('/') else '/' + path}"


def esc(value: Any) -> str:
    return html.escape(str(value or ""), quote=True)


def roster_card_name_html(value: Any) -> str:
    parts = str(value or "").strip().split()
    if not parts:
        return '<h2 class="player-card-name"></h2>'
    surname_len = 2 if len(parts) >= 2 and parts[0].lower() == "baccaro" and parts[1].lower() == "zeni" else 1
    surname = " ".join(parts[:surname_len])
    given = " ".join(parts[surname_len:])
    given_html = f' <span class="player-card-given">{esc(given)}</span>' if given else ""
    return f'<h2 class="player-card-name"><span class="player-card-surname">{esc(surname)}</span>{given_html}</h2>'


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
    for rel in output_dirs() + stale_dirs():
        target = ROOT / rel
        if target.exists():
            shutil.rmtree(target)


def render_shell(eyebrow: str, heading: str, body: str) -> str:
    return f'''<section class="section seo-prerender"><div class="container"><div class="head"><div><h1 class="title">{esc(heading)}</h1></div></div>{body}</div></section>'''


def render_news_teasers(news: List[Dict[str, Any]], limit: int = 36) -> str:
    cards = []
    for item in news[:limit]:
        url = item_path("news", item)
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
        visible_news = [item for item in data.get("news", []) if not is_hidden_news(item)]
        pieces.append(render_news_teasers(visible_news))
    elif route == "squad":
        roster = data.get("roster", []) if isinstance(data.get("roster"), list) else []
        pieces.append("<div class=\"grid grid-4\">" + "\n".join(
            f'''<article class="card player"><div class="player-top"><div class="avatar"><img loading="lazy" decoding="async" src="{esc(p.get('photo') or '/img/placeholder.webp')}" alt="{esc(p.get('name'))}"></div></div><div class="card-pad"><span class="badge">{esc(p.get('role'))}</span>{roster_card_name_html(p.get('name'))}<p class="muted">{esc(public_youth_text(p.get('team')))}</p></div></article>'''
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
            f'''<tr><td>{esc(r.get('pos'))}</td><td>{esc(r.get('team'))}</td><td>{esc(str(r.get('pts')) if r.get('pts') is not None else '')}</td><td>{esc(str(r.get('g')) if r.get('g') is not None else '')}</td></tr>'''
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
        table = "".join(
            f'''<tr><td>{esc(r.get('season'))}</td><td>{esc(r.get('competition') or season_competition(r.get('season')) or '-')}</td><td>{esc(r.get('played') or '-')}</td><td>{esc(r.get('wins') or '-')}</td><td>{esc(r.get('draws') or '-')}</td><td>{esc(r.get('losses') or '-')}</td><td>{esc(r.get('goalsFor') or '-')}</td><td>{esc(r.get('goalsAgainst') or '-')}</td><td>{esc(r.get('goalDifference') if r.get('goalDifference') is not None else '-')}</td></tr>'''
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

    if item.get("bodyHtml"):
        clean = re.sub(r"<script[\s\S]*?</script>", "", str(item["bodyHtml"]), flags=re.I)
        clean = re.sub(r"<style[\s\S]*?</style>", "", clean, flags=re.I)
        parts.append(clean)
    elif isinstance(item.get("contentBlocks"), list):
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
    tag_html = "".join(f'<span class="badge">{esc(public_youth_text(tag))}</span>' for tag in tag_values)
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
        path = item_path("news", item)
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
    text = " · ".join(public_youth_text(v) for v in values if v)
    return text_excerpt(text or item_title(key, item), 156)


def item_image(key: str, item: Dict[str, Any]) -> str | None:
    return item.get("image") or item.get("photo") or item.get("cover") or item.get("thumb") or item.get("logo")


def render_object_page(key: str, item: Dict[str, Any]) -> str:
    title = item_title(key, item)
    crumbs = COLLECTIONS[key].get("breadcrumb", ["/", "CUS Trento C5"])
    details: List[str] = []
    for label, field in [
        ("Ruolo", "role"), ("Squadra/Gruppo", "team"), ("Numero", "number"), ("Categoria", "category"),
        ("Tipo", "type"), ("Data", "date"), ("Orario", "time"), ("Luogo", "venue"), ("Prezzo", "price"),
    ]:
        if item.get(field) not in (None, ""):
            details.append(f'<div class="player-info-box"><span>{esc(label)}</span><b>{esc(public_youth_text(item.get(field)))}</b></div>')
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
    slug_label = "" if key == "roster" else f'<span>{esc(item.get("slug") or "")}</span>'
    body = (
        f'<div class="breadcrumb"><a class="back-link" href="{esc(crumbs[0])}"><span>←</span> {esc(crumbs[1])}</a>{slug_label}</div>'
        f'<div class="grid grid-2" style="margin-top:28px">'
        f'<article class="card card-pad article-body imported-article">{image_html}{"".join(body_bits)}</article>'
        f'<aside class="card card-pad"><h2>Dettagli</h2><div class="player-info-grid">{"".join(details) or "<p class=\"muted\">Dettagli in aggiornamento.</p>"}</div></aside>'
        f'</div>'
    )
    rendered = render_shell(crumbs[1], title, body)
    if key == "roster":
        rendered = rendered.replace(f'<h1 class="title">{esc(title)}</h1>', "")
    return rendered


def generate_object_pages(data: Dict[str, Any], urls: List[Tuple[str, str]]) -> None:
    for key in OBJECT_COLLECTIONS:
        items = data.get(key, []) if isinstance(data.get(key), list) else []
        for item in items:
            if not isinstance(item, dict):
                continue
            path = item_path(key, item)
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


def write_redirects() -> None:
    lines = ["# Generated by scripts/generate_static_pages.py from js/site-core.js redirects."]
    lines += [f"{r['from']} {r['to']} {r.get('status', 301)}" for r in CONFIG["redirects"]]
    (ROOT / "_redirects").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv: List[str]) -> int:
    if argv == ["--list-output-dirs"]:
        print("\n".join(output_dirs()))
        return 0
    if argv:
        raise SystemExit("usage: generate_static_pages.py [--list-output-dirs]")
    data = load_site_data()
    remove_generated_dirs()
    urls: List[Tuple[str, str]] = []
    generate_main_pages(data, urls)
    generate_news_pages(data, urls)
    generate_object_pages(data, urls)
    write_robots()
    write_sitemap(urls)
    write_redirects()
    print(f"Generated {len(data.get('news', []))} news pages, object slug pages, {len(MAIN_PAGES)} main pages, sitemap.xml, robots.txt and _redirects")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
