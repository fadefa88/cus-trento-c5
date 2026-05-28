#!/usr/bin/env python3
"""
Importa automaticamente su content/data.json le notizie SporTrentino che parlano di CUS Trento C5.

Cosa fa:
- scansiona le pagine elenco di calcioa5.sportrentino.it;
- apre ogni articolo;
- importa solo gli articoli in cui titolo o corpo contengono solo le keyword richieste: CUS Trento, C.U.S. Trento o CUS come parola autonoma;
- aggiunge fonte e link originale;
- evita duplicati tramite sourceUrl;
- ordina le news per data decrescente.

Uso:
  python scripts/import_sportrentino_news.py
  python scripts/import_sportrentino_news.py --max-pages 186
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
from bs4 import BeautifulSoup


BASE = "https://calcioa5.sportrentino.it/"
LIST_URL = BASE + "notizie.asp"
DEFAULT_IMAGE = "https://custrentocalcioa5.it/oldsite/wp-content/uploads/2026/01/1.-CUS-Trento-C5-scaled.png"

# Keyword richieste: solo CUS Trento, C.U.S. Trento e CUS come parola autonoma.
# Per "cus" usiamo una regex con confini parola: non matcha medoacus, accusa, focus, cuscino, ecc.
KEYWORD_PATTERNS = [
    re.compile(r"\bcus\s+trento\b", re.I),
    re.compile(r"\bc\.\s*u\.\s*s\.\s+trento\b", re.I),
    re.compile(r"(?<![a-z0-9])cus(?![a-z0-9])", re.I),
]


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


def parse_italian_date(text: str) -> str:
    raw = norm(text)
    m = re.search(r"(\d{1,2})\s+([a-zà]+)\s+(\d{4})", raw)
    if not m:
        return datetime.utcnow().strftime("%Y-%m-%d")
    day = int(m.group(1))
    month = MONTHS_IT.get(m.group(2), "01")
    year = int(m.group(3))
    return f"{year:04d}-{month}-{day:02d}"


def contains_cus(text: str) -> bool:
    t = norm(text)
    return any(pattern.search(t) for pattern in KEYWORD_PATTERNS)


def article_id_from_url(url: str) -> str:
    m = re.search(r"[?&]n=(\d+)", url)
    return m.group(1) if m else re.sub(r"\W+", "-", url).strip("-")


def fetch(session: requests.Session, url: str, timeout: int = 30) -> str:
    r = session.get(url, timeout=timeout, headers={
        "User-Agent": "CUS-Trento-C5-NewsImporter/1.0 (+https://custrentocalcioa5.it)"
    })
    r.raise_for_status()
    # The site may not always declare encoding correctly.
    if not r.encoding or r.encoding.lower() == "iso-8859-1":
        r.encoding = r.apparent_encoding or "utf-8"
    return r.text


def list_page_url(page: int) -> str:
    # 20 news per page: l = offset.
    offset = (page - 1) * 20
    return LIST_URL + "?" + urlencode({"s": 81, "l": offset, "li": 1, "s2": 81})


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

    # Extract body by collecting meaningful paragraphs after h1, stopping at author/sidebar/footer.
    body: list[str] = []

    if h1:
        for el in h1.find_all_next():
            if el.name in ["h1", "h2", "h3"]:
                heading = clean_text(el.get_text(" ", strip=True))
                if heading.lower() in {"autore", "classifica", "notizie", "foto e video"}:
                    break
            if el.name in ["p", "div"]:
                txt = clean_text(el.get_text(" ", strip=True))
                if not txt:
                    continue
                low = txt.lower()
                if low in {"autore", "classifica", "notizie", "foto e video"}:
                    break
                if "elenco degli argomenti" in low or "sportrentino.it è una testata" in low:
                    break
                if len(txt) >= 45 and txt not in body and title not in txt:
                    body.append(txt)

    # Fallback from full text lines.
    if not body:
        started = False
        for line in all_text_lines:
            if line == title:
                started = True
                continue
            if not started:
                continue
            low = line.lower()
            if low in {"autore", "classifica", "notizie", "foto e video"}:
                break
            if len(line) >= 45 and line not in body:
                body.append(line)

    full_text = " ".join([title, *body])
    if not contains_cus(full_text):
        return None

    article_images = extract_article_images(soup)
    image = article_images[0] if article_images else DEFAULT_IMAGE
    excerpt = body[0] if body else f"Articolo pubblicato da SporTrentino: {title}"
    if len(excerpt) > 240:
        excerpt = excerpt[:237].rstrip() + "..."

    aid = article_id_from_url(link.url)
    imported_id = int(f"81{aid}") if aid.isdigit() else abs(hash(link.url)) % 100000000

    return {
        "id": imported_id,
        "title": title,
        "category": category or "SporTrentino",
        "date": date,
        "author": "SporTrentino.it",
        "image": image,
        "images": article_images,
        "excerpt": excerpt,
        "body": body,
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="content/data.json", help="Path to content/data.json")
    parser.add_argument("--max-pages", type=int, default=186, help="List pages to scan")
    parser.add_argument("--sleep", type=float, default=0.35, help="Seconds between article requests")
    parser.add_argument("--limit-articles", type=int, default=0, help="Optional hard limit for debug")
    args = parser.parse_args()

    data_path = Path(args.data)
    data = load_data(data_path)
    existing_news = data.get("news", [])
    existing_sources = {n.get("sourceUrl") for n in existing_news if n.get("sourceUrl")}
    existing_ids = {str(n.get("id")) for n in existing_news if n.get("id") is not None}

    session = requests.Session()
    imported: list[dict] = []
    scanned_links = 0

    for page in range(1, args.max_pages + 1):
        url = list_page_url(page)
        print(f"[page {page}/{args.max_pages}] {url}")
        try:
            html_text = fetch(session, url)
        except Exception as exc:
            print(f"  WARN list page failed: {exc}")
            continue

        links = extract_article_links(html_text)
        print(f"  links found: {len(links)}")

        for link in links:
            scanned_links += 1
            if args.limit_articles and scanned_links > args.limit_articles:
                break

            if link.url in existing_sources:
                continue

            try:
                article = extract_article(session, link)
            except Exception as exc:
                print(f"  WARN article failed: {link.url} -> {exc}")
                time.sleep(args.sleep)
                continue

            if not article:
                time.sleep(args.sleep)
                continue

            # Make ID unique if needed.
            base_id = int(article["id"]) if isinstance(article.get("id"), int) else abs(hash(article["sourceUrl"])) % 100000000
            candidate = base_id
            while str(candidate) in existing_ids:
                candidate += 1
            article["id"] = candidate
            existing_ids.add(str(candidate))
            existing_sources.add(article["sourceUrl"])

            imported.append(article)
            print(f"  IMPORT {article['date']} - {article['title']}")
            time.sleep(args.sleep)

        if args.limit_articles and scanned_links > args.limit_articles:
            break

    if imported:
        data["news"] = sort_news(imported + existing_news)
        save_data(data_path, data)

    print("-" * 70)
    print(f"Scanned links: {scanned_links}")
    print(f"Imported new articles: {len(imported)}")
    print(f"Total news now: {len(data.get('news', []))}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
