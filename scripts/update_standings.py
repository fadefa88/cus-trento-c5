#!/usr/bin/env python3
"""
Aggiorna automaticamente le classifiche CUS Trento C5.

Sorgenti:
- Prima squadra / Serie B Girone B: https://www.tuttocampo.it/Italia/CalcioA5SerieB/GironeBSerieB/Classifica
- Under 21 / Serie D Girone B: https://calcioa5.sportrentino.it/camp_classifica.asp?pf=422&f=3565

Scrive in content/data.json:
- standings
- u21Standings

Per Tuttocampo lo script prova prima con requests. Se la pagina risponde 403,
usa Playwright/Chromium nel workflow GitHub Actions, renderizza la pagina come
un browser reale, salva uno screenshot di debug e normalizza la classifica dal
DOM/testo renderizzato.
"""

from __future__ import annotations

import argparse
import html as html_lib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup, Tag
from requests import HTTPError

SOURCES = {
    "standings": {
        "url": "https://www.tuttocampo.it/Italia/CalcioA5SerieB/GironeBSerieB/Classifica",
        "type": "tuttocampo",
    },
    "u21Standings": {
        "url": "https://calcioa5.sportrentino.it/camp_classifica.asp?pf=422&f=3565",
        "type": "sportrentino",
    },
}

ARTIFACTS_DIR = Path(os.environ.get("STANDINGS_ARTIFACTS_DIR", "standings-artifacts"))


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\xa0", " ")).strip()


def to_int(value: str) -> int:
    value = clean_text(str(value)).replace(".", "").replace(",", ".")
    m = re.search(r"-?\d+", value)
    return int(m.group(0)) if m else 0


def is_number(value: str) -> bool:
    return bool(re.fullmatch(r"-?\d+(?:[,.]\d+)?", clean_text(value)))


def normalize_team_name(name: str) -> str:
    return clean_text(name).upper()


def fetch_html(url: str) -> str:
    response = requests.get(
        url,
        timeout=30,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
            "Referer": "https://www.tuttocampo.it/",
            "Cache-Control": "no-cache",
        },
    )
    response.raise_for_status()
    if not response.encoding or response.encoding.lower() == "iso-8859-1":
        response.encoding = response.apparent_encoding or "utf-8"
    return response.text


def fetch_html_with_browser(url: str, source_type: str) -> str:
    """Render a blocked/dynamic page with Chromium and return DOM plus visible text.

    The screenshot is only a debug artifact. The parser reads the rendered DOM/text,
    not OCR pixels, because OCR would be more fragile and noisy.
    """
    try:
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError(
            "Playwright non installato. Nel workflow serve: pip install playwright && python -m playwright install --with-deps chromium"
        ) from exc

    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    safe_type = re.sub(r"[^a-z0-9_-]+", "-", source_type.lower()).strip("-") or "standings"
    screenshot_path = ARTIFACTS_DIR / f"{safe_type}-classifica.png"
    html_path = ARTIFACTS_DIR / f"{safe_type}-rendered.html"
    text_path = ARTIFACTS_DIR / f"{safe_type}-rendered.txt"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-blink-features=AutomationControlled"])
        context = browser.new_context(
            viewport={"width": 1440, "height": 1800},
            locale="it-IT",
            timezone_id="Europe/Rome",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/121.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except PlaywrightTimeoutError:
                pass
            for selector in [
                "button:has-text('Accetta')",
                "button:has-text('Accetto')",
                "button:has-text('OK')",
                "button:has-text('Consenti')",
                "text=Accetta tutto",
            ]:
                try:
                    locator = page.locator(selector).first
                    if locator.is_visible(timeout=1200):
                        locator.click(timeout=2500)
                        break
                except Exception:
                    continue
            page.wait_for_timeout(2500)
            page.screenshot(path=str(screenshot_path), full_page=True)
            rendered_html = page.content()
            visible_text = page.locator("body").inner_text(timeout=10000)
            html_path.write_text(rendered_html, encoding="utf-8")
            text_path.write_text(visible_text, encoding="utf-8")
            return rendered_html + "\n<!-- visible text fallback -->\n<pre>" + html_lib.escape(visible_text) + "</pre>"
        finally:
            context.close()
            browser.close()


def fetch_source_html(url: str, source_type: str) -> str:
    try:
        return fetch_html(url)
    except HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else None
        if source_type == "tuttocampo" and status_code == 403:
            print("  requests blocked with 403; trying Chromium render + screenshot...", flush=True)
            return fetch_html_with_browser(url, source_type)
        raise


def row_values(tr: Tag) -> list[str]:
    cells = tr.find_all(["th", "td"])
    if cells:
        return [clean_text(c.get_text(" ", strip=True)) for c in cells if clean_text(c.get_text(" ", strip=True))]
    return [clean_text(x) for x in tr.stripped_strings if clean_text(x)]


def team_from_row(tr: Tag, values: list[str]) -> str:
    ignored = {"ultima", "calendario", "classifica", "incroci", "organici", "marcatori", "statistiche"}
    for a in tr.find_all("a"):
        txt = clean_text(a.get_text(" ", strip=True))
        if txt and txt.lower() not in ignored and not is_number(txt):
            return txt
    for value in values[1:]:
        if value and not is_number(value):
            return value
    return ""


def parse_row_from_tr(tr: Tag, source_url: str) -> dict[str, Any] | None:
    values = row_values(tr)
    if not values or not is_number(values[0]):
        return None

    team = team_from_row(tr, values)
    if not team:
        return None

    try:
        team_index = values.index(team)
    except ValueError:
        team_index = 1

    numeric_values = [v for v in values[team_index + 1 :] if is_number(v)]
    if len(numeric_values) < 7:
        # Alcune pagine possono mettere i punti prima della squadra: prendi tutti i numeri dopo la posizione.
        numeric_values = [v for v in values[1:] if is_number(v)]
    if len(numeric_values) < 7:
        return None

    logo = ""
    img = tr.find("img")
    if img and img.get("src"):
        logo = urljoin(source_url, img.get("src") or "")

    return {
        "g": to_int(numeric_values[1]),
        "logo": logo,
        "gs": to_int(numeric_values[6]),
        "n": to_int(numeric_values[3]),
        "pts": to_int(numeric_values[0]),
        "p": to_int(numeric_values[4]),
        "pos": to_int(values[0]),
        "v": to_int(numeric_values[2]),
        "team": normalize_team_name(team),
        "gf": to_int(numeric_values[5]),
    }


def parse_sportrentino_rows_from_text(soup: BeautifulSoup) -> list[dict[str, Any]]:
    text = clean_text(soup.get_text(" ", strip=True))
    start = text.find("Classifica Squadra Pt")
    end = text.find("Pt=Punti", start)
    if start == -1 or end == -1:
        return []

    chunk = text[start:end]
    pattern = re.compile(
        r"(?:^|\s)(\d{1,2})\s+(.+?)\s+"
        r"(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+"
        r"\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+",
        re.I,
    )
    rows: list[dict[str, Any]] = []
    for m in pattern.finditer(chunk):
        team = clean_text(re.sub(r"^.*?Gs\s+", "", m.group(2)).strip())
        rows.append(
            {
                "g": to_int(m.group(4)),
                "logo": "",
                "gs": to_int(m.group(9)),
                "n": to_int(m.group(6)),
                "pts": to_int(m.group(3)),
                "p": to_int(m.group(7)),
                "pos": to_int(m.group(1)),
                "v": to_int(m.group(5)),
                "team": normalize_team_name(team),
                "gf": to_int(m.group(8)),
            }
        )
    return rows


def parse_tuttocampo_rows_from_text(soup: BeautifulSoup) -> list[dict[str, Any]]:
    """Fallback generico per pagine Tuttocampo appiattite o con markup non tabellare."""
    text = clean_text(soup.get_text(" ", strip=True))
    if "Classifica" not in text:
        return []

    # Tenta prima il formato più probabile: posizione, squadra, punti, gare, vinte, nulle, perse, GF, GS.
    pattern = re.compile(
        r"(?:^|\s)(\d{1,2})\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9' .\-&]+?)\s+"
        r"(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)(?:\s+[-+]?\d+)?",
        re.I,
    )
    rows: list[dict[str, Any]] = []
    seen: set[int] = set()
    bad_words = {"pos", "squadra", "punti", "classifica", "calendario", "marcatori", "statistiche"}
    for m in pattern.finditer(text):
        pos = to_int(m.group(1))
        team = clean_text(m.group(2))
        if pos <= 0 or pos in seen:
            continue
        if len(team) < 2 or team.lower() in bad_words or len(team) > 60:
            continue
        seen.add(pos)
        rows.append(
            {
                "g": to_int(m.group(4)),
                "logo": "",
                "gs": to_int(m.group(9)),
                "n": to_int(m.group(6)),
                "pts": to_int(m.group(3)),
                "p": to_int(m.group(7)),
                "pos": pos,
                "v": to_int(m.group(5)),
                "team": normalize_team_name(team),
                "gf": to_int(m.group(8)),
            }
        )
    return rows


def parse_standings(html_text: str, source_url: str, source_type: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html_text, "html.parser")
    rows: list[dict[str, Any]] = []
    seen_positions: set[int] = set()

    for tr in soup.find_all("tr"):
        parsed = parse_row_from_tr(tr, source_url)
        if not parsed:
            continue
        pos = int(parsed.get("pos") or 0)
        if pos <= 0 or pos in seen_positions:
            continue
        seen_positions.add(pos)
        rows.append(parsed)

    if not rows:
        rows = parse_tuttocampo_rows_from_text(soup) if source_type == "tuttocampo" else parse_sportrentino_rows_from_text(soup)

    rows = sorted(rows, key=lambda item: int(item.get("pos") or 9999))
    if not rows:
        raise ValueError(f"Nessuna riga classifica trovata nella pagina {source_type}")
    return rows


def preserve_missing_logos(new_rows: list[dict[str, Any]], old_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    old_by_team = {normalize_team_name(str(row.get("team", ""))): row for row in old_rows}
    for row in new_rows:
        key = normalize_team_name(str(row.get("team", "")))
        if not row.get("logo") and key in old_by_team:
            row["logo"] = old_by_team[key].get("logo", "")
    return new_rows


def update_data(data_path: Path) -> bool:
    data = json.loads(data_path.read_text(encoding="utf-8"))
    changed = False

    for key, source in SOURCES.items():
        url = source["url"]
        source_type = source["type"]
        print(f"Updating {key} from {url}", flush=True)
        html_text = fetch_source_html(url, source_type)
        new_rows = parse_standings(html_text, url, source_type)
        new_rows = preserve_missing_logos(new_rows, data.get(key, []))
        print(f"  rows parsed: {len(new_rows)}", flush=True)

        if data.get(key) != new_rows:
            data[key] = new_rows
            changed = True

    if changed:
        data_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return changed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="content/data.json", help="Path to content/data.json")
    args = parser.parse_args()

    data_path = Path(args.data)
    if not data_path.exists():
        print(f"ERROR: file not found: {data_path}", file=sys.stderr)
        return 1

    changed = update_data(data_path)
    if changed:
        print("Standings updated.", flush=True)
    else:
        print("No standings changes.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
