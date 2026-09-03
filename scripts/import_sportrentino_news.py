#!/usr/bin/env python3
"""
Importa automaticamente su content/data.json le notizie SporTrentino che parlano di CUS Trento C5.

Cosa fa:
- scansiona solo la pagina 1 configurata di calcioa5.sportrentino.it;
- apre ogni articolo;
- importa solo gli articoli in cui titolo o corpo contengono solo le keyword richieste: CUS Trento, C.U.S. Trento o CUS come parola autonoma;
- aggiunge fonte e link originale;
- evita duplicati tramite sourceUrl;
- ordina le news per data decrescente.

Uso:
  python scripts/import_sportrentino_news.py
  python scripts/import_sportrentino_news.py
  python scripts/import_sportrentino_news.py --max-pages 5 --sleep 0.8

Nota copyright:
  Lo script inserisce sourceName/sourceUrl in ogni articolo importato e mantiene gli URL reali assoluti degli articoli/immagini SporTrentino.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlencode

import requests
from bs4 import BeautifulSoup, NavigableString, Tag


BASE = "https://calcioa5.sportrentino.it/"
LIST_URL = BASE + "notizie.asp"
DEFAULT_IMAGE = "/img/placeholder.webp"

# Fonte unica da scansionare.
# Richiesta: usare SOLO la pagina 1 del feed generale SporTrentino calcio a 5.
# URL: https://calcioa5.sportrentino.it/notizie.asp?s=81&li=1&l=0&s2=81&p=1
LIST_SOURCES = [
    {
        "name": "calcio-a-5-pagina-1",
        "pages": 1,
        "params": {"s": 81, "li": 1, "l": 0, "s2": 81, "p": 1},
    },
]

# Keyword richieste:
# - Prima squadra: CUS Trento, C.U.S. Trento, oppure CUS come parola autonoma.
#   Nota: se nel testo compare "CUS Trento U21" o "CUS Trento U23", NON viene categorizzata Prima squadra.
# - Under 23: "CUS Trento U21" oppure "CUS Trento U23", case-insensitive.
FIRST_TEAM_PATTERNS = [
    re.compile(r"\bcus\s+trento\b", re.I),
    re.compile(r"\bc\.\s*u\.\s*s\.\s+trento\b", re.I),
    re.compile(r"(?<![a-z0-9])cus(?![a-z0-9])", re.I),
]
YOUTH_TEAM_PATTERN = re.compile(r"\bcus\s+trento\s+u(?:21|23)\b", re.I)


MONTHS_IT = {
    "gennaio": "01",
    "febbraio": "02",
    "marzo": "03",
    "aprile": "04",
    "maggio": "05",
    "giugno": "06",
    "luglio": "07",
    "agosto": "08",
    "settembre": "09",
    "ottobre": "10",
    "novembre": "11",
    "dicembre": "12",
}


@dataclass
class ArticleLink:
    title: str
    url: str
    category: str | None = None
    date: str | None = None


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip()).lower()


def clean_text(text: str) -> str:
    text = html.unescape(text or "")
    text = text.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def escape_html_text(text: str) -> str:
    return html.escape(text or "", quote=False)


def safe_attr(value: str) -> str:
    return html.escape(value or "", quote=True)


def is_editorial_image_url(url: str) -> bool:
    low = (url or "").lower()
    if any(skip in low for skip in [
        "pixel", "spacer", "facebook", "twitter", "instagram",
        "youtube", "logo_sportrentino", "banner", "adv", "pubblicita"
    ]):
        return False
    return bool(re.search(r"\.(jpg|jpeg|png|webp|gif)(\?|$)", low))


def absolutize_link(href: str) -> str:
    if not href:
        return ""
    href = href.strip()
    if href.startswith("#") or href.lower().startswith(("mailto:", "tel:")):
        return href
    return urljoin(BASE, href)


def inline_html(node) -> str:
    """Conserva link e formattazione base, rendendo assoluti gli URL."""
    if isinstance(node, NavigableString):
        return escape_html_text(str(node))

    if not isinstance(node, Tag):
        return ""

    name = (node.name or "").lower()

    if name == "a":
        href = absolutize_link(node.get("href") or "")
        inner = "".join(inline_html(child) for child in node.children).strip()
        if not inner:
            inner = escape_html_text(href)
        if href:
            return f'<a href="{safe_attr(href)}" target="_blank" rel="noopener noreferrer">{inner}</a>'
        return inner

    if name in {"strong", "b", "em", "i", "u"}:
        inner = "".join(inline_html(child) for child in node.children)
        tag = "strong" if name == "b" else ("em" if name == "i" else name)
        return f"<{tag}>{inner}</{tag}>"

    if name == "br":
        return "<br>"

    # Per altri tag inline/container, mantieni solo il contenuto testuale/linkato.
    return "".join(inline_html(child) for child in node.children)


def figure_html(src: str, alt: str = "") -> str:
    src_abs = urljoin(BASE, src)
    if not is_editorial_image_url(src_abs):
        return ""
    return (
        f'<figure class="imported-figure">'
        f'<a href="{safe_attr(src_abs)}" target="_blank" rel="noopener noreferrer">'
        f'<img loading="lazy" decoding="async" src="{safe_attr(src_abs)}" alt="{safe_attr(alt)}">'
        f'</a>'
        f'</figure>'
    )


def should_stop_article_scan(text: str) -> bool:
    low = norm(text)
    if not low:
        return False
    return low in {"autore", "classifica", "notizie", "foto e video"} or \
        "elenco degli argomenti" in low or \
        "sportrentino.it è una testata" in low or \
        "copyright" in low


def extract_article_content(soup: BeautifulSoup, title: str) -> tuple[list[str], str, list[str]]:
    """
    Estrae il contenuto editoriale preservando:
    - paragrafi in ordine;
    - link originali con href assoluti;
    - immagini nel punto in cui compaiono nell'articolo;
    - lista immagini per eventuale uso futuro.
    """
    h1 = soup.find("h1")
    if not h1:
        return [], "", extract_article_images(soup)

    blocks: list[str] = []
    text_body: list[str] = []
    images: list[str] = []
    seen_blocks: set[str] = set()
    seen_images: set[str] = set()

    # Primo passaggio: elementi successivi al titolo, in ordine documento.
    for el in h1.find_all_next(["p", "div", "img"]):
        if not isinstance(el, Tag):
            continue

        # Evita duplicati nested: se un <p> è dentro un <div> già preso, prendiamo il p e non il div generico.
        name = (el.name or "").lower()

        txt = clean_text(el.get_text(" ", strip=True))

        if should_stop_article_scan(txt):
            break

        if name == "img":
            src = el.get("src") or ""
            src_abs = urljoin(BASE, src)
            if is_editorial_image_url(src_abs) and src_abs not in seen_images:
                seen_images.add(src_abs)
                images.append(src_abs)
                fig = figure_html(src_abs, el.get("alt") or title)
                if fig:
                    blocks.append(fig)
            continue

        # Se il div contiene paragrafi o molte immagini, li gestiranno i figli; evita mega-duplicati.
        if name == "div" and (el.find("p") or el.find("img")):
            continue

        if not txt or txt == title or len(txt) < 30:
            continue

        if txt in seen_blocks:
            continue

        # Evita blocchi sidebar/menu.
        low = norm(txt)
        if any(skip in low for skip in [
            "condividi", "leggi anche", "ultime notizie", "torna indietro",
            "calcio a 5", "argomenti", "commenti"
        ]) and len(txt) < 120:
            continue

        html_block = "".join(inline_html(child) for child in el.children).strip()
        if not html_block:
            html_block = escape_html_text(txt)

        blocks.append(f"<p>{html_block}</p>")
        text_body.append(txt)
        seen_blocks.add(txt)

    # Fallback testuale se la struttura del sito non usa p/div in modo prevedibile.
    if not text_body:
        all_text_lines = [
            clean_text(x)
            for x in soup.get_text("\n", strip=True).splitlines()
            if clean_text(x)
        ]
        started = False
        for line in all_text_lines:
            if line == title:
                started = True
                continue
            if not started:
                continue
            if should_stop_article_scan(line):
                break
            if len(line) >= 45 and line not in text_body:
                text_body.append(line)
                blocks.append(f"<p>{escape_html_text(line)}</p>")

    # Se non abbiamo intercettato immagini inline, conserva comunque le immagini editoriali trovate.
    if not images:
        images = extract_article_images(soup)

    body_html = "\n".join(blocks)
    return text_body, body_html, images


def parse_italian_date(text: str) -> str:
    raw = norm(text)
    m = re.search(r"(\d{1,2})\s+([a-zà]+)\s+(\d{4})", raw)
    if not m:
        return datetime.utcnow().strftime("%Y-%m-%d")
    day = int(m.group(1))
    month = MONTHS_IT.get(m.group(2), "01")
    year = int(m.group(3))
    return f"{year:04d}-{month}-{day:02d}"


def classify_cus_article(text: str) -> str | None:
    """
    Ritorna:
    - "Under 23" se trova CUS Trento U21 oppure CUS Trento U23
    - "Prima squadra" se trova keyword CUS/CUS Trento ma non una delle due keyword giovanili
    - None se non è rilevante per CUS Trento
    """
    t = norm(text)

    if YOUTH_TEAM_PATTERN.search(t):
        return "Under 23"

    if any(pattern.search(t) for pattern in FIRST_TEAM_PATTERNS):
        return "Prima squadra"

    return None


def contains_cus(text: str) -> bool:
    return classify_cus_article(text) is not None


def article_id_from_url(url: str) -> str:
    m = re.search(r"[?&]n=(\d+)", url)
    return m.group(1) if m else re.sub(r"\W+", "-", url).strip("-")


def fetch(session: requests.Session, url: str, timeout: int = 30) -> str:
    r = session.get(url, timeout=timeout, headers={
        "User-Agent": "CUS-Trento-C5-NewsImporter/1.0 (+https://calcioa5.custrento.it)"
    })
    r.raise_for_status()
    # The site may not always declare encoding correctly.
    if not r.encoding or r.encoding.lower() == "iso-8859-1":
        r.encoding = r.apparent_encoding or "utf-8"
    return r.text


def list_page_url(source: dict, page: int) -> str:
    """
    SporTrentino pagina l'elenco con il parametro p.
    Il parametro l resta a 0: usare l=20/40/... produce URL diversi/non coerenti
    e può saltare molte notizie.
    Esempio corretto:
      notizie.asp?s=81&li=1&l=0&s2=81&p=2
    """
    params = dict(source["params"])
    params["l"] = 0
    params["p"] = page
    return LIST_URL + "?" + urlencode(params)


def page_count_from_html(html_text: str, fallback: int) -> int:
    """
    Legge dal testo pagina la dicitura tipo:
    - "Lista completa delle notizie (3717)" e "pag. / 186"
    - "Indice delle notizie (704)" e "pag. / 36"
    Se non riesce, usa il fallback configurato.
    """
    soup = BeautifulSoup(html_text, "html.parser")
    text = clean_text(soup.get_text(" ", strip=True))

    # Pattern più diretto: "pag. / 186" oppure "pag. / 36 argomenti".
    m = re.search(r"pag\.\s*/\s*(\d+)", text, re.I)
    if m:
        return max(1, int(m.group(1)))

    # Fallback matematico dal totale articoli.
    m = re.search(r"(?:Lista completa|Indice)\s+delle\s+notizie\s*\((\d+)\)", text, re.I)
    if m:
        total = int(m.group(1))
        return max(1, (total + 19) // 20)

    return int(fallback) if fallback else 1


def extract_article_links(html_text: str) -> list[ArticleLink]:
    soup = BeautifulSoup(html_text, "html.parser")
    links: list[ArticleLink] = []

    seen = set()
    for a in soup.find_all("a", href=True):
        href = a.get("href") or ""
        title = clean_text(a.get_text(" ", strip=True))
        if "notizie.asp" not in href or "n=" not in href or not title:
            continue
        url = urljoin(BASE, href)
        aid = article_id_from_url(url)
        if aid in seen:
            continue
        seen.add(aid)
        links.append(ArticleLink(title=title, url=url))

    return links


def extract_article_images(soup: BeautifulSoup) -> list[str]:
    """Estrae le immagini reali dell'articolo e le rende URL assoluti."""
    candidates: list[str] = []
    for img in soup.find_all("img"):
        src = img.get("src") or ""
        if not src:
            continue

        abs_src = urljoin(BASE, src)
        low = abs_src.lower()

        # Escludi asset grafici ricorrenti/non editoriali.
        if any(skip in low for skip in [
            "pixel", "spacer", "facebook", "twitter", "instagram",
            "youtube", "logo_sportrentino", "banner", "adv", "pubblicita"
        ]):
            continue

        # Tieni solo formati immagine plausibili.
        if not re.search(r"\.(jpg|jpeg|png|webp|gif)(\?|$)", low):
            continue

        if abs_src not in candidates:
            candidates.append(abs_src)

    return candidates


def extract_main_image(soup: BeautifulSoup) -> str:
    images = extract_article_images(soup)
    return images[0] if images else DEFAULT_IMAGE


def extract_article(session: requests.Session, link: ArticleLink) -> dict | None:
    html_text = fetch(session, link.url)
    soup = BeautifulSoup(html_text, "html.parser")

    h1 = soup.find("h1")
    title = clean_text(h1.get_text(" ", strip=True) if h1 else link.title)

    # Category/date: use visible text before h1 when possible.
    all_text_lines = [
        clean_text(x)
        for x in soup.get_text("\n", strip=True).splitlines()
        if clean_text(x)
    ]

    date = link.date
    category = link.category or "SporTrentino"

    # Find line like "24 maggio 2026 Serie C1" or separate date lines.
    for line in all_text_lines[:40]:
        if re.search(r"\d{1,2}\s+[a-zà]+\s+\d{4}", norm(line)):
            date = parse_italian_date(line)
            # Remove date from category if same line includes it.
            category_guess = re.sub(r"\d{1,2}\s+[A-Za-zà]+\s+\d{4}", "", line).strip()
            if category_guess and len(category_guess) < 40:
                category = category_guess
            break

    if not date:
        date = datetime.utcnow().strftime("%Y-%m-%d")

    # Extract body preserving article links and inline images.
    body, body_html, article_images = extract_article_content(soup, title)

    full_text = " ".join([title, *body])
    team_tag = classify_cus_article(full_text)
    if not team_tag:
        return None

    image = article_images[0] if article_images else DEFAULT_IMAGE
    excerpt = body[0] if body else f"Articolo pubblicato da SporTrentino: {title}"
    if len(excerpt) > 240:
        excerpt = excerpt[:237].rstrip() + "..."

    aid = article_id_from_url(link.url)
    imported_id = int(f"81{aid}") if aid.isdigit() else abs(hash(link.url)) % 100000000

    return {
        "id": imported_id,
        "title": title,
        "category": "SporTrentino",
        "tags": ["SporTrentino", team_tag],
        "teamTag": team_tag,
        "originalCategory": category or "SporTrentino",
        "date": date,
        "author": "SporTrentino.it",
        "image": image,
        "images": article_images,
        "excerpt": excerpt,
        "body": body,
        "bodyHtml": body_html,
        "pinned": False,
        "sourceName": "SporTrentino.it",
        "sourceUrl": link.url,
        "sourceId": aid,
        "importedFrom": "sportrentino",
    }


def load_data(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_data(path: Path, data: dict) -> None:
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def sort_news(news: list[dict]) -> list[dict]:
    return sorted(news, key=lambda n: (n.get("date") or "", int(n.get("id") or 0)), reverse=True)


def news_index_item(n: dict) -> dict:
    keys = [
        "id", "title", "category", "tags", "teamTag", "originalCategory", "date",
        "author", "image", "images", "excerpt", "pinned", "sourceName", "sourceUrl",
        "sourceId", "importedFrom", "importSource",
    ]
    return {key: n.get(key) for key in keys if key in n}


def save_news_index(path: Path, news: list[dict]) -> None:
    payload = {"news": [news_index_item(n) for n in sort_news(news)]}
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def news_identity(n: dict) -> str:
    return str(
        n.get("sourceUrl")
        or n.get("_sportrentino_source_url")
        or n.get("sourceId")
        or n.get("id")
        or f"{n.get('title','')}|{n.get('date','')}"
    )


def load_news_archive(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        payload = load_data(path)
    except Exception as exc:
        print(f"WARN imported-news archive not loaded: {path} -> {exc}", flush=True)
        return []
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("news"), list):
        return payload["news"]
    return []


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="content/data.json", help="Path to CMS content/data.json. New imports are written here.")
    parser.add_argument("--imported-archive", default="content/news.imported.json", help="Read-only archive of historical imported news used only for deduplication.")
    parser.add_argument("--news-index", default="content/news.index.json", help="Lightweight public news index used by the frontend for fast initial rendering.")
    parser.add_argument("--max-pages", type=int, default=1, help="Pages to scan. Use 186 only for a one-off mass import.")
    parser.add_argument("--sources", default="all", help="Comma-separated source names or 'all'.")
    parser.add_argument("--sleep", type=float, default=0.35, help="Seconds between article requests")
    parser.add_argument("--limit-articles", type=int, default=0, help="Optional hard limit for debug across all sources")
    args = parser.parse_args()

    data_path = Path(args.data)
    archive_path = Path(args.imported_archive)
    news_index_path = Path(args.news_index)
    data = load_data(data_path)
    existing_news = data.get("news", [])
    archived_news = load_news_archive(archive_path)
    all_known_news = [*existing_news, *archived_news]

    existing_sources = {n.get("sourceUrl") for n in all_known_news if n.get("sourceUrl")}
    existing_sources.update({n.get("_sportrentino_source_url") for n in all_known_news if n.get("_sportrentino_source_url")})
    existing_source_ids = {str(n.get("sourceId")) for n in all_known_news if n.get("sourceId") is not None}
    existing_identities = {news_identity(n) for n in all_known_news}
    existing_ids = {str(n.get("id")) for n in all_known_news if n.get("id") is not None}

    print("Importer version: v9 - CMS data.json + read-only imported archive dedup", flush=True)
    print(f"CMS news currently: {len(existing_news)}", flush=True)
    print(f"Archived imported news: {len(archived_news)}", flush=True)

    session = requests.Session()
    imported: list[dict] = []
    scanned_links = 0

    if args.sources.strip().lower() == "all":
        selected_sources = LIST_SOURCES
    else:
        wanted = {x.strip() for x in args.sources.split(",") if x.strip()}
        selected_sources = [s for s in LIST_SOURCES if s["name"] in wanted]
        missing = wanted - {s["name"] for s in selected_sources}
        if missing:
            print(f"WARN unknown source names ignored: {', '.join(sorted(missing))}", flush=True)

    print("Selected sources:", flush=True)
    for src in selected_sources:
        pages = args.max_pages if args.max_pages and args.max_pages > 0 else int(src["pages"])
        print(f"  - {src['name']}: {pages} page(s)", flush=True)

    for source in selected_sources:
        source_pages = args.max_pages if args.max_pages and args.max_pages > 0 else int(source["pages"])

        for page in range(1, source_pages + 1):
            url = list_page_url(source, page)
            print(f"[{source['name']}] [page {page}/{source_pages}] {url}", flush=True)
            try:
                html_text = fetch(session, url)
            except Exception as exc:
                print(f"  WARN list page failed: {exc}", flush=True)
                continue

            links = extract_article_links(html_text)
            print(f"  links found: {len(links)}", flush=True)

            for link in links:
                scanned_links += 1
                if args.limit_articles and scanned_links > args.limit_articles:
                    break

                source_id = article_id_from_url(link.url)
                if link.url in existing_sources or source_id in existing_source_ids:
                    continue

                try:
                    article = extract_article(session, link)
                except Exception as exc:
                    print(f"  WARN article failed: {link.url} -> {exc}", flush=True)
                    time.sleep(args.sleep)
                    continue

                if not article:
                    time.sleep(args.sleep)
                    continue

                if news_identity(article) in existing_identities:
                    time.sleep(args.sleep)
                    continue

                article["importSource"] = source["name"]

                # Make ID unique if needed.
                base_id = int(article["id"]) if isinstance(article.get("id"), int) else abs(hash(article["sourceUrl"])) % 100000000
                candidate = base_id
                while str(candidate) in existing_ids:
                    candidate += 1
                article["id"] = candidate
                existing_ids.add(str(candidate))
                existing_sources.add(article["sourceUrl"])
                existing_source_ids.add(str(article.get("sourceId")))
                existing_identities.add(news_identity(article))

                imported.append(article)
                print(f"  IMPORT {article['date']} - {article['title']}", flush=True)
                time.sleep(args.sleep)

            if args.limit_articles and scanned_links > args.limit_articles:
                break

        if args.limit_articles and scanned_links > args.limit_articles:
            break

    if imported:
        data["news"] = sort_news(imported + existing_news)
        save_data(data_path, data)

    save_news_index(news_index_path, sort_news(data.get("news", []) + archived_news))

    print("-" * 70)
    print(f"Scanned links: {scanned_links}")
    print(f"Imported new articles: {len(imported)}")
    print(f"CMS news now: {len(data.get('news', []))}")
    print(f"Total public news including archive: {len(data.get('news', [])) + len(archived_news)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
