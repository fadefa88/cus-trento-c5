#!/usr/bin/env python3
"""
Aggiorna automaticamente le classifiche CUS Trento C5 da SporTrentino.

Configurazione attuale:
- Prima squadra / Serie B 2026/27: classifica mantenuta manualmente in
  content/data.json (non viene sovrascritta dallo scraper).
- Under 21 / Serie D Girone B: aggiornata da SporTrentino.

Scrive in content/data.json:
- u21Standings

Non usa browser/Playwright: lo scraping torna a usare requests + BeautifulSoup
sulla pagina SporTrentino.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup, Tag

SOURCES = {
    "u21Standings": "https://calcioa5.sportrentino.it/camp_classifica.asp?pf=446&f=3668",
}

BASE_URL = "https://calcioa5.sportrentino.it/"


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\xa0", " ")).strip()


def to_int(value: str) -> int:
    value = clean_text(str(value)).replace(".", "").replace(",", ".")
    match = re.search(r"-?\d+", value)
    return int(match.group(0)) if match else 0


def normalize_team_name(name: str) -> str:
    return clean_text(name).upper()


def fetch_html(url: str) -> str:
    response = requests.get(
        url,
        timeout=30,
        headers={
            "User-Agent": "CUS-Trento-C5-StandingsUpdater/1.0 (+https://calcioa5.custrento.it)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "it-IT,it;q=0.9,en;q=0.7",
        },
    )
    response.raise_for_status()
    if not response.encoding or response.encoding.lower() == "iso-8859-1":
        response.encoding = response.apparent_encoding or "utf-8"
    return response.text


def row_values(tr: Tag) -> list[str]:
    # Il markup SporTrentino omette i tag di chiusura di celle e righe. Con
    # html.parser le righe successive possono quindi risultare annidate: usare
    # solo le celle figlie dirette evita di inglobare tutta la tabella corrente.
    cells = tr.find_all(["th", "td"], recursive=False)
    if cells:
        return [
            clean_text(cell.get_text(" ", strip=True))
            for cell in cells
            if clean_text(cell.get_text(" ", strip=True))
        ]
    return [clean_text(value) for value in tr.stripped_strings if clean_text(value)]


def is_number(value: str) -> bool:
    return bool(re.fullmatch(r"-?\d+(?:[,.]\d+)?", clean_text(value)))


def team_from_row(tr: Tag, values: list[str]) -> str:
    ignored = {
        "ultima",
        "calendario",
        "classifica",
        "incroci",
        "organici",
        "marcatori",
        "statistiche",
    }
    for anchor in tr.find_all("a"):
        text = clean_text(anchor.get_text(" ", strip=True))
        if text and text.lower() not in ignored and not is_number(text):
            return text
    for value in values[1:]:
        if value and not is_number(value):
            return value
    return ""


def parse_row_from_tr(tr: Tag, source_url: str) -> dict[str, Any] | None:
    values = row_values(tr)
    if not values or not re.fullmatch(r"\d+", values[0]):
        return None

    team = team_from_row(tr, values)
    if not team:
        return None

    try:
        team_index = values.index(team)
    except ValueError:
        team_index = 1

    numeric_values = [value for value in values[team_index + 1 :] if is_number(value)]
    if len(numeric_values) < 7:
        numeric_values = [value for value in values[1:] if is_number(value)]
    if len(numeric_values) < 7:
        return None

    logo = ""
    image = tr.find("img")
    if image and image.get("src"):
        logo = urljoin(source_url or BASE_URL, image.get("src") or "")

    # SporTrentino: posizione, squadra, Pt, G, V, N, P, GF, GS, ...
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


def parse_rows_from_text(soup: BeautifulSoup) -> list[dict[str, Any]]:
    """Fallback per il layout testuale della classifica SporTrentino."""
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
    for match in pattern.finditer(chunk):
        team = clean_text(re.sub(r"^.*?Gs\s+", "", match.group(2)).strip())
        rows.append(
            {
                "g": to_int(match.group(4)),
                "logo": "",
                "gs": to_int(match.group(9)),
                "n": to_int(match.group(6)),
                "pts": to_int(match.group(3)),
                "p": to_int(match.group(7)),
                "pos": to_int(match.group(1)),
                "v": to_int(match.group(5)),
                "team": normalize_team_name(team),
                "gf": to_int(match.group(8)),
            }
        )
    return rows


def parse_standings(html_text: str, source_url: str) -> list[dict[str, Any]]:
    # SporTrentino usa HTML legacy con molti tag </td> e </tr> omessi. lxml
    # ricostruisce correttamente le righe, mentre html.parser le annida.
    soup = BeautifulSoup(html_text, "lxml")
    rows: list[dict[str, Any]] = []

    standings_table = soup.select_one("table.st-classifica")
    table_rows = standings_table.select("tbody tr") if standings_table else soup.find_all("tr")

    for tr in table_rows:
        parsed = parse_row_from_tr(tr, source_url)
        if not parsed:
            continue
        pos = int(parsed.get("pos") or 0)
        if pos <= 0:
            continue
        rows.append(parsed)

    if not rows:
        rows = parse_rows_from_text(soup)

    rows = sorted(
        enumerate(rows),
        key=lambda item: (int(item[1].get("pos") or 9999), item[0]),
    )
    rows = [row for _, row in rows]
    if not rows:
        raise ValueError("Nessuna riga classifica trovata nella pagina SporTrentino")
    return rows


def preserve_missing_logos(
    new_rows: list[dict[str, Any]], old_rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    old_by_team = {
        normalize_team_name(str(row.get("team", ""))): row for row in old_rows
    }
    for row in new_rows:
        key = normalize_team_name(str(row.get("team", "")))
        if not row.get("logo") and key in old_by_team:
            row["logo"] = old_by_team[key].get("logo", "")
    return new_rows


def update_data(data_path: Path) -> bool:
    data = json.loads(data_path.read_text(encoding="utf-8"))
    changed = False

    print("Prima squadra: classifica manuale, non sovrascritta dallo scraper.", flush=True)

    for key, url in SOURCES.items():
        print(f"Updating {key} from {url}", flush=True)
        try:
            html_text = fetch_html(url)
            new_rows = parse_standings(html_text, url)
        except (requests.RequestException, ValueError) as exc:
            print(f"WARNING: impossibile aggiornare {key}: {exc}", flush=True)
            print(f"  Mantengo la classifica esistente in {data_path}.", flush=True)
            continue

        new_rows = preserve_missing_logos(new_rows, data.get(key, []))
        print(f"  rows parsed: {len(new_rows)}", flush=True)

        if data.get(key) != new_rows:
            data[key] = new_rows
            changed = True

    if changed:
        data_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
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
